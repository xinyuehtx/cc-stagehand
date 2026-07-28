import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SelectorStore } from "./selector-store.js";
import { updateCacheManifest } from "./cache-manifest.js";
import type { CacheProcessOptions, CacheProcessResult } from "./types.js";

/** 缓存更新选项 */
export interface CacheUpdateOptions {
  /** 缓存目录路径 */
  cacheDir: string;

  /** SelectorStore 实例（从 llmClient 获取） */
  selectorStore: SelectorStore;
}

/** 缓存更新结果 */
export interface CacheUpdateResult {
  /** 缓存文件总数 */
  totalFiles: number;

  /** 已更新的选择器数量 */
  updatedSelectors: number;

  /** 跳过的选择器数量（无对应 cssSelector 或非 xpath） */
  skippedSelectors: number;

  /** 更新详情 */
  details: Array<{
    file: string;
    instruction: string;
    oldSelector: string;
    newSelector: string;
  }>;
}

/**
 * 遍历缓存目录中的 JSON 文件，将 xpath 选择器替换为 SelectorStore 中的 CSS 选择器。
 * 仅处理以 "xpath=" 开头的选择器，非 xpath 选择器保持不变。
 */
export function generalizeCacheSelectors(options: CacheUpdateOptions): CacheUpdateResult {
  const { cacheDir, selectorStore } = options;
  const result: CacheUpdateResult = {
    totalFiles: 0,
    updatedSelectors: 0,
    skippedSelectors: 0,
    details: [],
  };

  let files: string[];
  try {
    files = readdirSync(cacheDir).filter(
      (f) => f.endsWith(".json") && f !== "manifest.json"
    );
  } catch {
    return result;
  }

  result.totalFiles = files.length;

  for (const file of files) {
    const filePath = join(cacheDir, file);

    let content: any;
    try {
      content = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      // JSON 解析失败，跳过
      continue;
    }

    if (!content.actions || !Array.isArray(content.actions)) continue;

    const instruction = typeof content.instruction === "string"
      ? content.instruction.trim()
      : undefined;

    // 精确匹配优先；无精确匹配时使用**安全**模糊匹配：
    // 仅当所有子串候选都指向同一个 selector（唯一）时才采用，
    // 出现歧义则跳过，避免把某指令的 selector 张冠李戴到另一指令上。
    let cssSelector = instruction ? selectorStore.get(instruction) : undefined;
    if (!cssSelector && instruction) {
      const candidates = new Set<string>();
      for (const [key, value] of selectorStore.entries()) {
        if (key.includes(instruction) || instruction.includes(key)) {
          candidates.add(value);
        }
      }
      if (candidates.size === 1) {
        cssSelector = candidates.values().next().value;
      }
    }

    let modified = false;
    for (const action of content.actions) {
      if (
        typeof action.selector === "string" &&
        action.selector.startsWith("xpath=")
      ) {
        if (cssSelector) {
          result.details.push({
            file,
            instruction: instruction!,
            oldSelector: action.selector,
            newSelector: cssSelector,
          });
          action.selector = cssSelector;
          modified = true;
          result.updatedSelectors++;
        } else {
          result.skippedSelectors++;
        }
      }
    }

    if (modified) {
      writeFileSync(filePath, JSON.stringify(content, null, 2));
    }
  }

  return result;
}

/**
 * 统一缓存后处理函数 — 同时执行选择器泛化和 manifest 更新。
 * 推荐在 afterAll 中调用。
 */
export function processCacheAfterAll(
  options: CacheProcessOptions
): CacheProcessResult {
  // 1. 调用 generalizeCacheSelectors
  const genResult = generalizeCacheSelectors({
    cacheDir: options.cacheDir,
    selectorStore: options.selectorStore as SelectorStore,
  });

  // 2. 调用 updateCacheManifest
  const manifestResult = updateCacheManifest({
    cacheDir: options.cacheDir,
    selectorStore: options.selectorStore,
    isFullRun: options.isFullRun,
    ttlSeconds: options.ttlSeconds,
    usedInstructions: options.usedInstructions,
  });

  return {
    generalization: {
      updatedSelectors: genResult.updatedSelectors,
      skippedSelectors: genResult.skippedSelectors,
    },
    manifest: manifestResult,
  };
}
