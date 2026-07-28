import { readFileSync, writeFileSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import type {
  CacheManifest,
  CacheManifestEntry,
  UpdateCacheManifestOptions,
  UpdateCacheManifestResult,
} from "./types.js";

const MANIFEST_FILENAME = "manifest.json";
const DEFAULT_TTL_SECONDS = 30 * 24 * 3600; // 30 天
const MANIFEST_VERSION = 1;

/** 加载 manifest（容错：损坏时返回空 manifest） */
function loadManifest(manifestPath: string, ttlSeconds: number): CacheManifest {
  try {
    const raw = readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version && parsed.entries) {
      return parsed as CacheManifest;
    }
  } catch {
    // 文件不存在或解析失败
  }
  return {
    version: MANIFEST_VERSION,
    updatedAt: new Date().toISOString(),
    ttlSeconds,
    entries: {},
  };
}

/** 原子写入 manifest（先写 tmp 再 rename） */
function saveManifest(manifestPath: string, manifest: CacheManifest): void {
  const tmpPath = manifestPath + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(manifest, null, 2));
  renameSync(tmpPath, manifestPath);
}

/** 主函数：更新缓存清单 */
export function updateCacheManifest(
  options: UpdateCacheManifestOptions
): UpdateCacheManifestResult {
  const {
    cacheDir,
    selectorStore,
    isFullRun = false,
    ttlSeconds = DEFAULT_TTL_SECONDS,
  } = options;
  const manifestPath = join(cacheDir, MANIFEST_FILENAME);
  const now = new Date().toISOString();

  const result: UpdateCacheManifestResult = {
    manifestPath,
    totalEntries: 0,
    added: 0,
    refreshed: 0,
    orphaned: 0,
    expired: 0,
  };

  // 1. 加载现有 manifest
  const manifest = loadManifest(manifestPath, ttlSeconds);
  manifest.ttlSeconds = ttlSeconds;

  // 2. 扫描 cacheDir 中的 .json 文件（排除 manifest.json）
  let files: string[];
  try {
    files = readdirSync(cacheDir).filter(
      (f) => f.endsWith(".json") && f !== MANIFEST_FILENAME
    );
  } catch {
    return result;
  }

  // 3. 构建「本次运行使用的 instruction」集合。
  //    ⚠️ selectorStore.usedInstructions 仅在缓存 MISS（真正调用 LLM）时填充；
  //    缓存 HIT 时 Stagehand 直接确定性回放，不经过 LLMClient，该集合会漏掉命中项。
  //    因此：
  //    - 若调用方显式提供 usedInstructions（权威集合），据此刷新并标记 orphan；
  //    - 否则回退到 store 的集合，且【不】标记 orphan，避免把仍在使用（命中缓存）
  //      的条目误标为孤儿导致误删。
  const providedUsed = options.usedInstructions
    ? new Set(Array.from(options.usedInstructions, (s) => s.trim()))
    : undefined;
  const usedInstructions: ReadonlySet<string> =
    providedUsed ?? selectorStore.usedInstructions;
  const canMarkOrphan = providedUsed !== undefined;
  const orphanedThisRun = new Set<string>();

  // 4. 处理每个缓存文件
  for (const file of files) {
    const filePath = join(cacheDir, file);
    const key = file.replace(/\.json$/, ""); // hash 作为 key

    let content: any;
    try {
      content = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      continue;
    }

    const instruction =
      typeof content.instruction === "string"
        ? content.instruction.trim()
        : "";
    const url = typeof content.url === "string" ? content.url : "";
    const selector = content.actions?.[0]?.selector ?? "";
    const generalized = selector !== "" && !selector.startsWith("xpath=");

    if (manifest.entries[key]) {
      // 已存在的条目
      const entry = manifest.entries[key];
      if (usedInstructions.has(instruction)) {
        // 本次运行使用了（命中或未命中）→ 刷新
        entry.lastUsed = now;
        entry.status = "active";
        entry.selector = selector;
        entry.generalized = generalized;
        result.refreshed++;
      } else if (isFullRun && canMarkOrphan) {
        // 全量运行 + 权威 used 集合中未包含 → 标记 orphan
        if (entry.status === "active") {
          entry.status = "orphan";
          orphanedThisRun.add(key);
          result.orphaned++;
        }
      }
      // 未提供权威 used 集合 / 部分运行 / 未使用 → 保持原状
    } else {
      // 新增条目
      manifest.entries[key] = {
        instruction,
        cacheFile: file,
        selector,
        url,
        createdAt: now,
        lastUsed: now,
        status: "active",
        generalized,
      };
      result.added++;
    }
  }

  // 5. TTL 过期检查
  const ttlMs = ttlSeconds * 1000;
  const nowMs = Date.now();
  for (const [key, entry] of Object.entries(manifest.entries)) {
    if (entry.status === "expired") continue;
    const lastUsedMs = new Date(entry.lastUsed).getTime();
    if (nowMs - lastUsedMs > ttlMs) {
      entry.status = "expired";
      result.expired++;
      // 若同一条目本次刚被标记为 orphan，改记为 expired，避免重复计数
      if (orphanedThisRun.has(key)) {
        result.orphaned--;
      }
    }
  }

  // 6. 更新并保存
  manifest.updatedAt = now;
  result.totalEntries = Object.keys(manifest.entries).length;
  saveManifest(manifestPath, manifest);

  return result;
}
