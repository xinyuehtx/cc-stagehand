/**
 * Claude Code LLMClient 类型定义
 */

/** ClaudeCodeLLMClient 配置选项 */
export interface ClaudeCodeLLMClientOptions {
  /** 额外的 system prompt 增强 */
  systemPromptEnhancement?: string;

  /**
   * claude -p 命令的额外参数
   * @deprecated 请使用 agentArgs 代替
   */
  claudeArgs?: string[];

  /** Agent 类型选择（默认 "claude"） */
  agentType?: "claude" | "opencode" | "qodercli";

  /** Agent CLI 的额外参数（通用，优先于 claudeArgs） */
  agentArgs?: string[];

  /** Claude Code 的工作目录（用于发现 CLAUDE.md skill 文件） */
  cwd?: string;

  /** 日志级别 */
  logLevel?: "debug" | "info" | "warn" | "error";

  /** 日志输出目标 */
  logTarget?: "auto" | "stdout" | "file";

  /** 日志文件路径 */
  logFilePath?: string;

  /** 自愈事件回调 */
  onSelfHeal?: (event: SelfHealEvent) => void | Promise<void>;

  /** Claude Code 调用超时时间（毫秒） */
  timeout?: number;

  /** 是否启用 verbose 模式 */
  verbose?: boolean;

  /** 是否启用 selector 泛化（默认 true） */
  enableSelectorGeneralization?: boolean;
}

/** Claude Code 响应格式 */
export interface ClaudeCodeResponse {
  /** 文本结果 */
  result: string;

  /** 结构化输出（通过 --json-schema 标志获得） */
  structured_output?: any;

  /** 会话 ID */
  session_id: string;

  /** 总成本（美元） */
  total_cost_usd: number;

  /** 模型成本明细 */
  cost_usd: Record<string, number>;
}

/** 自愈事件 */
export interface SelfHealEvent {
  /** 测试名称 */
  testName: string;

  /** act() 指令 */
  instruction: string;

  /** 旧选择器（失效） */
  oldSelector: string;

  /** 新选择器（自愈后） */
  newSelector: string;

  /** 失效原因 */
  reason: string;

  /** 自愈耗时（毫秒） */
  durationMs: number;

  /** Claude Code 调用成本（美元） */
  costUsd: number;

  /** 时间戳 */
  timestamp: string;
}

/** 自愈报告 */
export interface SelfHealReport {
  /** 总自愈事件数 */
  totalEvents: number;

  /** 事件列表 */
  events: SelfHealEvent[];

  /** 总成本（美元） */
  totalCostUsd: number;

  /** 生成 git commit */
  generateGitCommit(message?: string): Promise<string | null>;
}

/** E2E 测试结果 */
export interface E2ETestResult {
  /** 测试名称 */
  name: string;

  /** 状态 */
  status: "passed" | "self-healed" | "failed";

  /** 步骤详情 */
  steps: Array<{
    instruction: string;
    cacheStatus: "hit" | "miss" | "healed";
    selector: string;
    oldSelector?: string;
    durationMs: number;
    error?: string;
  }>;

  /** 自愈 commit hash */
  selfHealCommit?: string;

  /** 总耗时 */
  totalDurationMs: number;

  /** Claude Code 调用次数 */
  claudeCodeCalls: number;

  /** Claude Code 成本（美元） */
  claudeCodeCostUsd: number;
}

/** E2E 报告数据 */
export interface E2EReportData {
  /** 时间戳 */
  timestamp: string;

  /** 汇总统计 */
  summary: {
    total: number;
    passed: number;
    selfHealed: number;
    failed: number;
    cacheHitRate: number;
    totalClaudeCodeCalls: number;
    totalClaudeCodeCostUsd: number;
  };

  /** 测试结果列表 */
  tests: E2ETestResult[];
}

/** Chat 消息内容 */
export type ChatMessageContent =
  | string
  | Array<{ type: string; text?: string; image_url?: { url: string } }>;

/** Chat 消息 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: ChatMessageContent;
}

/** Chat 完成选项 */
export interface ChatCompletionOptions {
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  image?: {
    buffer: Buffer;
    description?: string;
  };
  response_model?: {
    name: string;
    schema: any;
  };
  tools?: any[];
  tool_choice?: "auto" | "none" | "required";
  maxOutputTokens?: number;
  requestId?: string;
}

/** LLM 响应 */
export interface LLMResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls: Array<{
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** LLMClient 接口 */
export interface LLMClient {
  createChatCompletion(options: ChatCompletionOptions): Promise<LLMResponse>;
}
