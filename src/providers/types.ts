/**
 * Language Model Provider 接口定义
 */
import type { Logger } from "../logger.js";
import type { ClaudeCodeResponse } from "../types.js";

/** 支持的 Agent 类型 */
export type AgentType = "claude" | "opencode" | "qodercli";

/** Provider 通用配置选项 */
export interface LanguageModelProviderOptions {
  /** 额外的 system prompt 增强 */
  systemPromptEnhancement?: string;
  /** Agent CLI 的额外参数 */
  agentArgs?: string[];
  /** 工作目录 */
  cwd?: string;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 是否启用 verbose 模式 */
  verbose?: boolean;
  /** 日志记录器 */
  logger: Logger;
}

/** Language Model Provider 接口 */
export interface LanguageModelProvider {
  /** Agent 类型标识 */
  readonly type: AgentType;
  /** 生成 LLM 响应 */
  generate(
    systemPrompt: string | undefined,
    userPrompt: string,
    jsonSchema?: object
  ): Promise<ClaudeCodeResponse>;
}
