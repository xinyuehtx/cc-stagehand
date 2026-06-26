/**
 * Stagehand Claude Code Skill Agent
 *
 * 使用 Claude Code 作为 Stagehand 的 LLM 执行引擎，
 * 结合业务 skill 知识生成高泛化性选择器，通过缓存机制实现 CI 稳定性。
 */

// 主要 API
export { createClaudeCodeLLMClient } from "./llm-client.js";
export { SelfHealTracker } from "./self-heal.js";
export { E2EReport } from "./report.js";
export { SelectorStore } from "./selector-store.js";
export { generalizeCacheSelectors } from "./cache-updater.js";

// 类型定义
export type {
  ClaudeCodeLLMClientOptions,
  ClaudeCodeResponse,
  SelfHealEvent,
  SelfHealReport,
  E2ETestResult,
  E2EReportData,
  LLMClient,
  ChatCompletionOptions,
  ChatMessage,
  ChatMessageContent,
  LLMResponse,
} from "./types.js";

export type { CacheUpdateOptions, CacheUpdateResult } from "./cache-updater.js";
