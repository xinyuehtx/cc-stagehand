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

  // 3. 构建 usedInstructions 快速查找
  const usedInstructions = selectorStore.usedInstructions;

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
        // 本次运行使用了 → 刷新
        entry.lastUsed = now;
        entry.status = "active";
        entry.selector = selector;
        entry.generalized = generalized;
        result.refreshed++;
      } else if (isFullRun) {
        // 全量运行但未使用 → 标记 orphan
        if (entry.status === "active") {
          entry.status = "orphan";
          result.orphaned++;
        }
      }
      // 部分运行且未使用 → 保持原状
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
  for (const [_key, entry] of Object.entries(manifest.entries)) {
    if (entry.status === "expired") continue;
    const lastUsedMs = new Date(entry.lastUsed).getTime();
    if (nowMs - lastUsedMs > ttlMs) {
      entry.status = "expired";
      result.expired++;
    }
  }

  // 6. 更新并保存
  manifest.updatedAt = now;
  result.totalEntries = Object.keys(manifest.entries).length;
  saveManifest(manifestPath, manifest);

  return result;
}
