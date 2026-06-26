import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SelectorStore } from "./selector-store.js";

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
    files = readdirSync(cacheDir).filter((f) => f.endsWith(".json"));
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

    // 精确匹配 → 模糊匹配（SelectorStore key 可能包含 cache instruction 作为子串）
    let cssSelector = instruction ? selectorStore.get(instruction) : undefined;
    if (!cssSelector && instruction) {
      for (const [key, value] of selectorStore.entries()) {
        if (key.includes(instruction) || instruction.includes(key)) {
          cssSelector = value;
          break;
        }
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
