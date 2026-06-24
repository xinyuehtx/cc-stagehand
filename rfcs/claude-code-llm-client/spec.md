# SPEC: Stagehand Claude Code LLMClient 技术规格

**版本：** 1.0  
**状态：** 已批准  
**日期：** 2026-01-22  
**依赖 RFC：** RFC v5（已批准）

---

## 1. 概述

本 SPEC 定义了 `@browserbasehq/stagehand-skill-agent` 包的技术规格，包括 API 设计、数据结构、实现细节和集成方式。

**核心组件：**
- `ClaudeCodeLLMClient`：自定义 LLMClient，调用 `claude -p` 执行 LLM 推理
- `ClaudeCodeLanguageModel`：内部实现，封装 `claude -p` 命令构建和执行
- `Logger`：双日志策略（本地文件 / CI stdout）
- `SelfHealTracker`：跟踪自愈事件，支持 git commit 生成
- `E2EReport`：测试报告生成器

**关键设计原则（来自 RFC v5）：**
1. **不实现自定义 skill loader**：利用 Claude Code 现有的 CLAUDE.md / `--project-dir` 机制
2. **复用 Stagehand 的 prompt**：Stagehand 构建的 messages 直接传给 `claude -p`，仅在 `--append-system-prompt` 中追加少量增强
3. **双日志策略**：本地环境输出到 log 文件，CI 环境输出到 stdout

---

## 2. 公共 API

### 2.1 主入口

```typescript
// src/index.ts
export { createClaudeCodeLLMClient } from "./llm-client.js";
export { SelfHealTracker } from "./self-heal.js";
export { E2EReport } from "./report.js";
export type {
  ClaudeCodeLLMClientOptions,
  SelfHealEvent,
  SelfHealReport,
  E2EReportData,
  E2ETestResult,
} from "./types.js";
```

### 2.2 createClaudeCodeLLMClient

创建自定义 LLMClient，替换 Stagehand 的默认 LLM 调用。

```typescript
export interface ClaudeCodeLLMClientOptions {
  /**
   * 额外的 system prompt 增强（追加到 Stagehand 的 system prompt 之后）
   * 用于注入少量选择器策略指导
   */
  systemPromptEnhancement?: string;
  
  /**
   * claude -p 命令的额外参数
   * 例如: ["--project-dir", "./e2e-skills"]
   */
  claudeArgs?: string[];
  
  /**
   * 日志级别
   * @default "info"
   */
  logLevel?: "debug" | "info" | "warn" | "error";
  
  /**
   * 日志输出目标
   * - "auto": 自动检测（CI → stdout，本地 → 文件）
   * - "stdout": 强制 stdout
   * - "file": 强制文件
   * @default "auto"
   */
  logTarget?: "auto" | "stdout" | "file";
  
  /**
   * 日志文件路径（logTarget="file" 时使用）
   * @default "./.stagehand-logs/llm-client.log"
   */
  logFilePath?: string;
  
  /**
   * 自愈事件回调
   */
  onSelfHeal?: (event: SelfHealEvent) => void | Promise<void>;
  
  /**
   * Claude Code 调用超时时间（毫秒）
   * @default 30000
   */
  timeout?: number;
  
  /**
   * 是否启用 verbose 模式（详细日志）
   * @default false
   */
  verbose?: boolean;
}

export function createClaudeCodeLLMClient(
  options: ClaudeCodeLLMClientOptions = {}
): LLMClient;
```

**使用示例：**

```typescript
import { Stagehand } from "@browserbasehq/stagehand";
import { createClaudeCodeLLMClient } from "@browserbasehq/stagehand-skill-agent";

const stagehand = new Stagehand({
  env: "LOCAL",
  llmClient: createClaudeCodeLLMClient({
    // 少量 prompt 增强（不替代 Stagehand 的 prompt）
    systemPromptEnhancement: `
      ## 选择器策略
      优先使用 data-testid 属性，其次是 aria-label，最后才是 XPath。
    `,
    
    // 指定 skill 目录（Claude Code 自动加载其中的 CLAUDE.md）
    claudeArgs: ["--project-dir", "./e2e-skills"],
    
    // 日志配置
    logLevel: "info",
    logTarget: "auto",  // CI → stdout, 本地 → file
  }),
  cacheDir: "./.stagehand-cache",
});
```

### 2.3 SelfHealTracker

跟踪自愈事件，支持生成 git commit。

```typescript
export interface SelfHealEvent {
  /**
   * 测试名称
   */
  testName: string;
  
  /**
   * act() 指令
   */
  instruction: string;
  
  /**
   * 旧选择器（失效）
   */
  oldSelector: string;
  
  /**
   * 新选择器（自愈后）
   */
  newSelector: string;
  
  /**
   * 失效原因
   */
  reason: string;
  
  /**
   * 自愈耗时（毫秒）
   */
  durationMs: number;
  
  /**
   * Claude Code 调用成本（美元）
   */
  costUsd: number;
  
  /**
   * 时间戳
   */
  timestamp: string;
}

export interface SelfHealReport {
  /**
   * 总自愈事件数
   */
  totalEvents: number;
  
  /**
   * 事件列表
   */
  events: SelfHealEvent[];
  
  /**
   * 总成本（美元）
   */
  totalCostUsd: number;
  
  /**
   * 生成 git commit（如果可能）
   * @returns commit hash 或 null
   */
  generateGitCommit(message?: string): Promise<string | null>;
}

export class SelfHealTracker {
  constructor(options?: {
    cacheDir?: string;
    gitBranch?: string;
  });
  
  /**
   * 记录自愈事件
   */
  record(event: SelfHealEvent): void;
  
  /**
   * 获取报告
   */
  getReport(): SelfHealReport;
  
  /**
   * 清空事件
   */
  clear(): void;
}
```

**使用示例：**

```typescript
import { SelfHealTracker } from "@browserbasehq/stagehand-skill-agent";

const tracker = new SelfHealTracker({
  cacheDir: "./.stagehand-cache",
  gitBranch: "fix/e2e-self-heal",
});

// 在 onSelfHeal 回调中使用
const stagehand = new Stagehand({
  llmClient: createClaudeCodeLLMClient({
    onSelfHeal: (event) => {
      tracker.record(event);
    },
  }),
});

// 测试结束后生成报告
const report = tracker.getReport();
console.log(`自愈事件: ${report.totalEvents}, 成本: $${report.totalCostUsd}`);

// 生成 git commit
const commitHash = await report.generateGitCommit(
  "fix(e2e): self-heal selectors"
);
console.log(`Commit: ${commitHash}`);
```

### 2.4 E2EReport

生成 E2E 测试报告。

```typescript
export interface E2ETestResult {
  /**
   * 测试名称
   */
  name: string;
  
  /**
   * 状态
   */
  status: "passed" | "self-healed" | "failed";
  
  /**
   * 步骤详情
   */
  steps: Array<{
    instruction: string;
    cacheStatus: "hit" | "miss" | "healed";
    selector: string;
    oldSelector?: string;
    durationMs: number;
    error?: string;
  }>;
  
  /**
   * 自愈 commit hash
   */
  selfHealCommit?: string;
  
  /**
   * 总耗时
   */
  totalDurationMs: number;
  
  /**
   * Claude Code 调用次数
   */
  claudeCodeCalls: number;
  
  /**
   * Claude Code 成本（美元）
   */
  claudeCodeCostUsd: number;
}

export interface E2EReportData {
  /**
   * 时间戳
   */
  timestamp: string;
  
  /**
   * 汇总统计
   */
  summary: {
    total: number;
    passed: number;
    selfHealed: number;
    failed: number;
    cacheHitRate: number;
    totalClaudeCodeCalls: number;
    totalClaudeCodeCostUsd: number;
  };
  
  /**
   * 测试结果列表
   */
  tests: E2ETestResult[];
}

export class E2EReport {
  constructor();
  
  /**
   * 添加测试结果
   */
  addTest(result: E2ETestResult): void;
  
  /**
   * 获取报告数据
   */
  getData(): E2EReportData;
  
  /**
   * 输出到 stdout
   */
  printToStdout(): void;
  
  /**
   * 输出到文件
   */
  writeToFile(filePath: string): Promise<void>;
  
  /**
   * 生成 JSON 字符串
   */
  toJSON(): string;
}
```

**使用示例：**

```typescript
import { E2EReport } from "@browserbasehq/stagehand-skill-agent";

const report = new E2EReport();

// 在测试中添加结果
report.addTest({
  name: "登录流程",
  status: "passed",
  steps: [
    {
      instruction: "点击登录按钮",
      cacheStatus: "hit",
      selector: "[data-testid='login-btn']",
      durationMs: 23,
    },
    // ...
  ],
  totalDurationMs: 1500,
  claudeCodeCalls: 0,
  claudeCodeCostUsd: 0,
});

// 输出报告
report.printToStdout();
await report.writeToFile("./e2e-report.json");
```

---

## 3. 数据结构

### 3.1 Claude Code 命令参数

```typescript
interface ClaudeCommandArgs {
  /**
   * Prompt 文本（Stagehand 的 user message，原样传入）
   */
  prompt: string;
  
  /**
   * System prompt（Stagehand 的 system message + systemPromptEnhancement）
   */
  systemPrompt?: string;
  
  /**
   * 输出格式
   * @default "json"
   */
  outputFormat?: "text" | "json" | "stream-json";
  
  /**
   * JSON Schema（结构化输出）
   */
  jsonSchema?: object;
  
  /**
   * 最大轮数
   * @default 1（单次推理）
   */
  maxTurns?: number;
  
  /**
   * 预算限制（美元）
   */
  maxBudgetUsd?: number;
  
  /**
   * 会话 ID（复用会话）
   */
  sessionId?: string;
  
  /**
   * 额外参数（如 --project-dir）
   */
  extraArgs?: string[];
}
```

### 3.2 Claude Code 响应格式

```typescript
interface ClaudeCodeResponse {
  /**
   * 文本结果
   */
  result: string;
  
  /**
   * 结构化输出（如果使用 --json-schema）
   */
  structured_output?: {
    elementId: string;
    method: "click" | "fill" | "type" | "press" | "selectOption";
    arguments?: string[];
    twoStep?: boolean;
  };
  
  /**
   * 会话 ID
   */
  session_id: string;
  
  /**
   * 总成本（美元）
   */
  total_cost_usd: number;
  
  /**
   * 模型成本明细
   */
  cost_usd: Record<string, number>;
}
```

### 3.3 Stagehand LLMResponse 格式

```typescript
interface LLMResponse {
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
```

### 3.4 缓存条目格式（Stagehand 兼容）

```typescript
interface CachedActEntry {
  version: 1;
  instruction: string;
  url: string;
  variableKeys: string[];
  actions: Array<{
    selector: string;
    description: string;
    method?: string;
    arguments?: string[];
  }>;
  actionDescription: string;
  message: string;
}
```

---

## 4. 实现细节

### 4.1 ClaudeCodeLLMClient 实现

```typescript
// src/llm-client.ts

import type { LLMClient, ChatCompletionOptions } from "@browserbasehq/stagehand";
import { ClaudeCodeLanguageModel } from "./claude-code-model.js";
import { Logger } from "./logger.js";

export class ClaudeCodeLLMClient implements LLMClient {
  private model: ClaudeCodeLanguageModel;
  private logger: Logger;
  
  constructor(options: ClaudeCodeLLMClientOptions) {
    this.logger = new Logger({
      level: options.logLevel ?? "info",
      target: options.logTarget ?? "auto",
      filePath: options.logFilePath,
    });
    
    this.model = new ClaudeCodeLanguageModel({
      systemPromptEnhancement: options.systemPromptEnhancement,
      claudeArgs: options.claudeArgs,
      timeout: options.timeout ?? 30000,
      verbose: options.verbose ?? false,
      logger: this.logger,
    });
  }
  
  async createChatCompletion(options: ChatCompletionOptions) {
    this.logger.debug("LLMClient.createChatCompletion 被调用", {
      messageCount: options.messages.length,
    });
    
    // 1. 提取 Stagehand 传入的 messages（不修改）
    const { systemPrompt, userPrompt } = this.extractPrompts(options.messages);
    
    // 2. 调用 Claude Code
    const result = await this.model.generate(systemPrompt, userPrompt);
    
    // 3. 转换为 Stagehand 期望的 LLMResponse 格式
    return this.convertToStagehandResponse(result);
  }
  
  private extractPrompts(messages: ChatMessage[]): {
    systemPrompt: string | undefined;
    userPrompt: string;
  } {
    // Stagehand 的消息格式：[system, user] 或 [user]
    const systemMessage = messages.find(m => m.role === "system");
    const userMessage = messages.find(m => m.role === "user");
    
    if (!userMessage) {
      throw new Error("No user message found in Stagehand messages");
    }
    
    // 提取 system prompt（如果有）
    const systemPrompt = systemMessage
      ? this.extractTextFromContent(systemMessage.content)
      : undefined;
    
    // 提取 user prompt（AX 树 + 指令）
    const userPrompt = this.extractTextFromContent(userMessage.content);
    
    return { systemPrompt, userPrompt };
  }
  
  private extractTextFromContent(content: ChatMessageContent): string {
    if (typeof content === "string") {
      return content;
    }
    
    // 处理多部分消息（文本 + 图片）
    const textParts = content.filter(p => p.type === "text");
    return textParts.map(p => p.text).join("\n");
  }
  
  private convertToStagehandResponse(
    result: ClaudeCodeResponse
  ): LLMResponse {
    // Claude Code 的 structured_output 已经是正确的格式
    const outputText = result.structured_output
      ? JSON.stringify(result.structured_output)
      : result.result;
    
    return {
      id: `claude-code-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "claude-code",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: outputText,
            tool_calls: [],
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: Math.ceil(outputText.length / 4),
        completion_tokens: Math.ceil(outputText.length / 4),
        total_tokens: Math.ceil(outputText.length / 2),
      },
    };
  }
}
```

### 4.2 ClaudeCodeLanguageModel 实现

```typescript
// src/claude-code-model.ts

import { spawn } from "node:child_process";
import type { Logger } from "./logger.js";

export class ClaudeCodeLanguageModel {
  constructor(
    private options: {
      systemPromptEnhancement?: string;
      claudeArgs?: string[];
      timeout?: number;
      verbose?: boolean;
      logger: Logger;
    }
  ) {}
  
  async generate(
    systemPrompt: string | undefined,
    userPrompt: string
  ): Promise<ClaudeCodeResponse> {
    const startTime = Date.now();
    
    // 1. 构建 claude -p 命令
    const commandArgs = this.buildCommandArgs(systemPrompt, userPrompt);
    
    this.options.logger.debug("Claude Code 命令", {
      command: `claude ${commandArgs.join(" ")}`,
    });
    
    // 2. 执行 claude -p
    const claudeResponse = await this.executeClaudeCommand(commandArgs);
    
    const durationMs = Date.now() - startTime;
    
    this.options.logger.info("Claude Code 调用完成", {
      durationMs,
      costUsd: claudeResponse.total_cost_usd,
      sessionId: claudeResponse.session_id,
    });
    
    return claudeResponse;
  }
  
  private buildCommandArgs(
    systemPrompt: string | undefined,
    userPrompt: string
  ): string[] {
    const args = ["-p", userPrompt];
    
    // 追加 system prompt（Stagehand 的 + 增强）
    if (systemPrompt || this.options.systemPromptEnhancement) {
      const fullSystemPrompt = [
        systemPrompt ?? "",
        this.options.systemPromptEnhancement ?? "",
      ]
        .filter(Boolean)
        .join("\n\n");
      
      args.push("--append-system-prompt", fullSystemPrompt);
    }
    
    // 输出格式
    args.push("--output-format", "json");
    
    // 单次推理（不需要 agent loop）
    args.push("--max-turns", "1");
    
    // 额外参数（如 --project-dir）
    if (this.options.claudeArgs) {
      args.push(...this.options.claudeArgs);
    }
    
    return args;
  }
  
  private async executeClaudeCommand(
    args: string[]
  ): Promise<ClaudeCodeResponse> {
    return new Promise((resolve, reject) => {
      const proc = spawn("claude", args, {
        timeout: this.options.timeout,
      });
      
      let stdout = "";
      let stderr = "";
      
      proc.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      
      proc.on("close", (code) => {
        if (code !== 0) {
          this.options.logger.error("Claude Code 执行失败", {
            exitCode: code,
            stderr: stderr.substring(0, 500),
          });
          reject(new Error(`claude -p exited with code ${code}: ${stderr}`));
          return;
        }
        
        try {
          const response = JSON.parse(stdout) as ClaudeCodeResponse;
          resolve(response);
        } catch (error) {
          this.options.logger.error("Claude Code 响应解析失败", {
            stdout: stdout.substring(0, 500),
            error: String(error),
          });
          reject(new Error(`Failed to parse Claude Code response: ${error}`));
        }
      });
      
      proc.on("error", (error) => {
        this.options.logger.error("Claude Code 启动失败", {
          error: String(error),
        });
        reject(new Error(`Failed to spawn claude process: ${error}`));
      });
    });
  }
}
```

### 4.3 Logger 实现

```typescript
// src/logger.ts

import { writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class Logger {
  private target: "stdout" | "file";
  private filePath?: string;
  private level: "debug" | "info" | "warn" | "error";
  
  constructor(options: {
    level?: "debug" | "info" | "warn" | "error";
    target?: "auto" | "stdout" | "file";
    filePath?: string;
  }) {
    this.level = options.level ?? "info";
    
    // 自动检测日志目标
    if (options.target === "auto" || !options.target) {
      this.target = this.detectTarget();
    } else {
      this.target = options.target;
    }
    
    if (this.target === "file") {
      this.filePath = options.filePath ?? "./.stagehand-logs/llm-client.log";
      this.ensureLogDirectory();
    }
  }
  
  private detectTarget(): "stdout" | "file" {
    // 检测 CI 环境
    const isCI = !!(
      process.env.CI ||
      process.env.GITHUB_ACTIONS ||
      process.env.GITLAB_CI ||
      process.env.JENKINS_URL ||
      process.env.CIRCLECI ||
      process.env.TRAVIS
    );
    
    return isCI ? "stdout" : "file";
  }
  
  private ensureLogDirectory() {
    if (!this.filePath) return;
    
    const dir = dirname(this.filePath);
    try {
      mkdirSync(dir, { recursive: true });
    } catch (error) {
      // 忽略错误，后续写入时会报错
    }
  }
  
  debug(message: string, data?: Record<string, any>) {
    if (this.level === "debug") {
      this.log("DEBUG", message, data);
    }
  }
  
  info(message: string, data?: Record<string, any>) {
    if (["debug", "info"].includes(this.level)) {
      this.log("INFO", message, data);
    }
  }
  
  warn(message: string, data?: Record<string, any>) {
    if (["debug", "info", "warn"].includes(this.level)) {
      this.log("WARN", message, data);
    }
  }
  
  error(message: string, data?: Record<string, any>) {
    this.log("ERROR", message, data);
  }
  
  private log(level: string, message: string, data?: Record<string, any>) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level}] ${message}${
      data ? " " + JSON.stringify(data) : ""
    }\n`;
    
    if (this.target === "stdout") {
      process.stdout.write(logLine);
    } else if (this.target === "file" && this.filePath) {
      appendFileSync(this.filePath, logLine);
    }
  }
}
```

---

## 5. Skill 加载策略

### 5.1 利用 Claude Code 现有能力

**不实现自定义 skill loader**，而是利用 Claude Code 的现有机制：

1. **CLAUDE.md 文件**：在项目根目录或 skill 目录放置 CLAUDE.md，Claude Code 自动加载
2. **`--project-dir` 参数**：通过 `claudeArgs` 指定 skill 目录
3. **`--append-system-prompt` 参数**：通过 `systemPromptEnhancement` 注入少量增强

### 5.2 推荐的 Skill 文件结构

```
项目根目录/
├── CLAUDE.md                    # Claude Code 自动加载
├── e2e-skills/
│   ├── CLAUDE.md                # Skill 专用 CLAUDE.md
│   ├── selector-strategy.md     # 选择器策略
│   └── login-page.md            # 登录页面 skill
└── tests/
    └── login.spec.ts            # E2E 测试
```

**CLAUDE.md 内容示例：**

```markdown
# E2E Testing Skill Context

## 选择器策略

优先使用以下选择器类型（按稳定性排序）：
1. `data-testid` 属性（如 `[data-testid="login-btn"]`）
2. `aria-label` 属性
3. ARIA `role` + 可访问名称
4. 避免使用带 hash 后缀的 CSS class

## 已知元素

- 登录按钮: `[data-testid="login-btn"]` 或 `[aria-label="Sign in"]`
- 用户名输入: `[data-testid="email-input"]` 或 `[name="email"]`
- 密码输入: `[data-testid="password-input"]` 或 `[name="password"]`

## 注意事项

- 登录按钮在加载时可能显示 `aria-disabled="true"`，需要等待
- 验证码在 `iframe#captcha-frame` 中
```

### 5.3 配置方式

```typescript
const llmClient = createClaudeCodeLLMClient({
  // 少量增强（可选，因为 CLAUDE.md 已经提供大部分上下文）
  systemPromptEnhancement: `
    在生成选择器时，严格遵循 CLAUDE.md 中的选择器策略。
    如果 AX Tree 中的元素属性匹配已知元素，优先选择该元素。
  `,
  
  // 指定 skill 目录（Claude Code 会自动加载其中的 CLAUDE.md）
  claudeArgs: ["--project-dir", "./e2e-skills"],
});
```

---

## 6. 日志策略

### 6.1 双日志目标

- **本地环境**：输出到 log 文件（`./.stagehand-logs/llm-client.log`）
- **CI 环境**：输出到 stdout（便于 CI 系统收集）

### 6.2 自动检测

```typescript
const isCI = !!(
  process.env.CI ||
  process.env.GITHUB_ACTIONS ||
  process.env.GITLAB_CI ||
  process.env.JENKINS_URL ||
  process.env.CIRCLECI ||
  process.env.TRAVIS
);

const logTarget = isCI ? "stdout" : "file";
```

### 6.3 日志级别

- `debug`：详细日志（命令参数、响应内容）
- `info`：一般信息（调用成功、耗时、成本）
- `warn`：警告（超时、重试）
- `error`：错误（执行失败、解析失败）

### 6.4 日志格式

```
[2026-01-22T10:30:45.123Z] [INFO] Claude Code 调用完成 {
  "durationMs": 2100,
  "costUsd": 0.003,
  "sessionId": "abc-123"
}
```

---

## 7. 错误处理

### 7.1 Claude Code 执行失败

```typescript
try {
  const result = await llmClient.createChatCompletion(options);
} catch (error) {
  if (error.message.includes("claude -p exited with code")) {
    // Claude Code 执行失败
    logger.error("Claude Code 执行失败", { error: error.message });
    // 返回默认响应或抛出
  }
}
```

### 7.2 超时处理

```typescript
const proc = spawn("claude", args, {
  timeout: options.timeout ?? 30000,
});

proc.on("close", (code) => {
  if (code === null) {
    // 超时
    logger.error("Claude Code 执行超时", {
      timeout: options.timeout,
    });
    reject(new Error(`Claude Code execution timed out after ${options.timeout}ms`));
  }
});
```

### 7.3 响应解析失败

```typescript
try {
  const response = JSON.parse(stdout);
} catch (error) {
  logger.error("Claude Code 响应解析失败", {
    stdout: stdout.substring(0, 500),
    error: String(error),
  });
  reject(new Error(`Failed to parse Claude Code response: ${error}`));
}
```

---

## 8. 性能优化

### 8.1 缓存优先

- CI 运行时全部命中缓存，零 `claude -p` 调用
- 缓存文件提交到 Git，确保 CI 环境可用

### 8.2 批量预热

- 开发时使用预热脚本批量生成选择器
- 减少首次运行时的 `claude -p` 调用次数

### 8.3 会话复用（未来）

- 使用 `--session-id` 复用 Claude Code 会话
- 减少初始化开销

### 8.4 并行执行（未来）

- 多个 `act()` 调用可以并行执行 `claude -p`
- 需要 Stagehand 支持

---

## 9. 测试策略

### 9.1 单元测试

- `ClaudeCodeLLMClient`：mock `spawn`，验证命令构建和响应解析
- `ClaudeCodeLanguageModel`：mock `spawn`，验证参数转换
- `Logger`：验证日志输出格式和目标

### 9.2 集成测试

- 使用真实 `claude -p` 调用，验证端到端流程
- 使用测试页面，验证选择器生成质量

### 9.3 E2E 测试

- 在真实项目中集成，验证缓存命中率和自愈成功率
- 收集性能指标（耗时、成本）

---

## 10. 兼容性

### 10.1 Stagehand 版本

- 最低版本：Stagehand v3.0.0
- 推荐版本：Stagehand v3.6.0+

### 10.2 Claude Code 版本

- 最低版本：Claude Code CLI v1.0.0
- 推荐版本：Claude Code CLI v1.5.0+

### 10.3 Node.js 版本

- 最低版本：Node.js 18.0.0
- 推荐版本：Node.js 20.0.0+

---

## 11. 附录

### 11.1 完整类型定义

见 `src/types.ts`。

### 11.2 示例代码

见 `examples/` 目录。

### 11.3 API 参考

见 RFC v5 附录 C。

---

**文档结束**
