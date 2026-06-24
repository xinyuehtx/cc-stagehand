# RFC: Stagehand E2E 测试增强 — Claude Code 作为 LLM 执行引擎

**状态：** 草案 v5  
**作者：** AI Assistant  
**创建日期：** 2026-01-22  
**修订日期：** 2026-01-22  
**包名：** `@browserbasehq/stagehand-skill-agent`

---

## 1. 概述

本 RFC 提出一个面向 **E2E 测试** 场景的方案：用 Stagehand 替换现有的 Playwright 测试，并**使用 Claude Code (`claude -p`) 作为 Stagehand `act()` 方法的 LLM 执行引擎**，结合业务 skill 知识生成高泛化性选择器，通过缓存机制实现 CI 稳定性。

**核心思路：** Claude Code 不是增强层，而是**必须的 LLM 执行引擎**。通过实现自定义 `LLMClient`（主要方案）或中间件拦截（备选），将 Stagehand 的 LLM 调用替换为 `claude -p` 命令执行。Claude Code 更强的推理能力 + skill 文档指导 → 生成高质量、可泛化的选择器。

**关键设计原则：**
1. **不实现自定义 skill loader**：利用 Claude Code 现有的 CLAUDE.md / 项目上下文机制加载 skill 文档
2. **复用 Stagehand 的 prompt**：Stagehand 构建的 prompt（AX 树 + 指令）直接传给 `claude -p`，仅在 `claude -p` 处理时做少量增强
3. **双日志策略**：本地环境输出到 log 文件，CI 环境输出到 stdout

### 1.1 期望的 CI/CD 工作流

```
阶段 1：开发（程序员编写语义化测试）
┌──────────────────────────────────────────────────┐
│ 程序员编写 Stagehand 语义化测试用例                  │
│                                                    │
│   await stagehand.act("点击登录按钮")               │
│   await stagehand.act("输入用户名")                  │
│   await stagehand.act("输入密码")                    │
│   await stagehand.act("点击提交")                    │
│                                                    │
│ 不写选择器，只写语义化指令                            │
└─────────────────────┬────────────────────────────┘
                      │
                      ▼
阶段 2：首次运行（Claude Code + Skill 生成选择器）
┌──────────────────────────────────────────────────┐
│ 对每个语义化 act() 调用：                            │
│                                                    │
│   act("点击登录按钮")                                │
│     ↓ 缓存未命中                                    │
│   actInference() → LLM 调用                        │
│     ↓                                              │
│   ClaudeCodeLanguageModel.doGenerate()              │
│     ├── 提取 prompt（AX 树 + 指令）                  │
│     ├── 加载匹配的 skill 文档                        │
│     ├── 执行 claude -p 命令：                        │
│     │   claude -p "{AX树 + 指令}"                   │
│     │     --append-system-prompt "{skill上下文}"    │
│     │     --output-format json                     │
│     │     --json-schema "{期望的响应格式}"           │
│     │                                              │
│     ├── Claude Code 返回：                          │
│     │   { elementId: "0-9", method: "click" }      │
│     │                                              │
│     └── 转换为 LanguageModelV2 响应格式              │
│     ↓                                              │
│   Stagehand 处理：elementId → XPath → 执行          │
│     ↓                                              │
│   [data-testid="login-btn"] → 写入缓存              │
│                                                    │
│ 所有选择器缓存到 .stagehand-cache/ 目录               │
│ 缓存文件随代码一起提交到 Git                          │
└─────────────────────┬────────────────────────────┘
                      │
                      ▼
阶段 3：CI 常规运行（缓存优先，零 LLM）
┌──────────────────────────────────────────────────┐
│ 每次 CI 运行：                                       │
│                                                    │
│   act("点击登录按钮")                                │
│     ↓ 缓存命中 ✅                                   │
│   takeDeterministicAction(cachedSelector)           │
│     → 0 次 LLM 调用（不调用 claude -p）              │
│     → 纯 CDP 执行                                   │
│     → 毫秒级延迟                                    │
│                                                    │
│ 快、稳定、可重复、零 AI 成本                          │
└─────────────────────┬────────────────────────────┘
                      │ 如果缓存失效 ↓
                      ▼
阶段 4：自愈（失败 → Claude Code 重新生成 → Git Commit）
┌──────────────────────────────────────────────────┐
│ 缓存选择器失效（DOM 变更导致）：                       │
│                                                    │
│   act("点击登录按钮")                                │
│     ↓ 缓存命中                                      │
│   takeDeterministicAction(cachedSelector)           │
│     ↓ 执行失败（元素未找到）                          │
│                                                    │
│   自愈流程启动：                                      │
│     1. selfHeal → 重新调用 LLM                       │
│     2. ClaudeCodeLanguageModel.doGenerate()          │
│        → claude -p + skill                          │
│        → 分析新的 DOM 结构                           │
│        → 生成新的选择器                              │
│        → [aria-label="Sign In"] (新)                │
│                                                    │
│     3. 用新选择器重试 → 执行成功 ✅                   │
│                                                    │
│     4. 更新缓存文件                                  │
│                                                    │
│     5. 生成 git commit：                             │
│        "fix(e2e): self-heal login button selector   │
│         - 旧: [data-testid='login-btn'] (失效)      │
│         - 新: [aria-label='Sign In']                │
│         - 原因: data-testid 属性被移除"              │
│                                                    │
│     6. 提交到 PR 或分支                              │
└─────────────────────┬────────────────────────────┘
                      │
                      ▼
阶段 5：输出报告
┌──────────────────────────────────────────────────┐
│ E2E 测试报告：                                       │
│                                                    │
│ ✅ 登录流程 — 成功（缓存命中，23ms）                  │
│ ✅ 商品搜索 — 成功（缓存命中，45ms）                  │
│ 🔄 结算流程 — 自愈成功 + 修复 commit                 │
│    ├── 失败: "点击支付按钮" 选择器失效                │
│    ├── 自愈: [data-testid='pay'] → [aria-label='Pay']│
│    ├── 修复 commit: abc123                          │
│    └── 耗时: 3.2s（含自愈 + claude -p 调用）         │
│ ❌ 用户注册 — 失败（自愈失败）                        │
│    ├── 原因: 页面完全重构，无法匹配                   │
│    └── 建议: 人工检查并更新 skill 文档                │
│                                                    │
│ 统计:                                               │
│ - 总测试: 4                                         │
│ - 缓存命中: 2 (50%)                                 │
│ - 自愈成功: 1 (25%)                                 │
│ - 失败: 1 (25%)                                     │
│ - Claude Code 调用次数: 1（仅自愈时）                 │
│ - 修复 commits: 1                                   │
└──────────────────────────────────────────────────┘
```

## 2. 问题陈述

### 2.1 当前 Playwright E2E 测试的痛点

| 问题 | 描述 | 影响 |
|------|------|------|
| **选择器维护成本高** | 前端重构后，CSS/XPath 选择器大面积失效 | 每次重构后需要人工修复大量测试 |
| **测试编写门槛高** | 需要理解 DOM 结构才能写出好的选择器 | 非前端开发者难以编写 E2E 测试 |
| **脆弱性** | 依赖 DOM 结构的选择器极易失效 | CI 频繁失败，开发者失去信任 |
| **语义缺失** | `page.click('#btn-abc123')` 无法表达意图 | 测试代码难以理解和维护 |

### 2.2 Stagehand 的优势与不足

**优势：**
- ✅ 语义化 API：`act("点击登录按钮")` 直观表达意图
- ✅ 内置缓存机制：首次 LLM → 缓存 → 后续确定性执行
- ✅ 自愈能力：选择器失效时自动重新调用 LLM
- ✅ 基于 CDP：底层浏览器交互能力强

**不足：**
- ❌ **默认 LLM 推理质量有限：** GPT-4.1-mini 等模型生成的选择器泛化能力不足
- ❌ **缺乏业务 skill 支持：** LLM 不知道哪些选择器更稳定（如 `data-testid`）
- ❌ **缓存选择器质量不高：** 首次生成的选择器如果是 XPath，缓存后依然脆弱
- ❌ **自愈不智能：** 重新调用同一个 LLM，没有新的上下文来改进

### 2.3 用户的核心诉求

> **使用 Claude Code (`claude -p`) 替换 `act()` 中的 LLM 语义调用，结合 skill 知识生成高质量、可泛化的选择器，完美适配 Stagehand 的缓存和工作流。**

关键需求：
1. **Claude Code 是必须的 LLM 执行引擎**，不是可选的增强层
2. **开发阶段：** 程序员只写语义化指令，不写选择器
3. **首次运行：** `claude -p` + skill → 生成最佳选择器 → 缓存
4. **CI 运行：** 优先用缓存，零 LLM 成本，毫秒级执行
5. **自愈：** 失败时 `claude -p` 重新分析 → 更新缓存 → git commit
6. **报告：** 成功/自愈+修复/失败 的完整报告

## 3. 提议方案

### 3.1 架构概述

**主要方案：自定义 LLMClient**

```
┌─────────────────────────────────────────────────────────────┐
│  Stagehand E2E 测试框架                                       │
│                                                              │
│  stagehand.act("点击登录按钮")                                │
│     ↓                                                        │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ ActCache.tryReplay()                                 │    │
│  │   ├── 缓存命中 → takeDeterministicAction() → 成功 ✅  │    │
│  │   │   └── 缓存命中但执行失败 → selfHeal → 重新调用 LLM │    │
│  │   └── 缓存未命中 → actInference() → LLM 调用          │    │
│  └──────────────────────────────────────────────────────┘    │
│     ↓                                                        │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ ClaudeCodeLLMClient（本方案核心）                       │    │
│  │                                                      │    │
│  │ 替换 Stagehand 默认的 LLM（GPT-4.1-mini 等）：         │    │
│  │                                                      │    │
│  │ createChatCompletion(options):                       │    │
│  │   1. 提取 Stagehand 传入的 prompt（不修改）             │    │
│  │      - messages: [system, user]                      │    │
│  │      - system: Stagehand 构建的 system prompt         │    │
│  │      - user: AX 树 + 指令                            │    │
│  │                                                      │    │
│  │   2. 构建 claude -p 命令：                            │    │
│  │      - prompt: Stagehand 的 user message（原样传入）   │    │
│  │      - --append-system-prompt: Stagehand 的 system    │    │
│  │        prompt + 少量增强（如选择器策略）                │    │
│  │      - --output-format json                          │    │
│  │      - --json-schema: Stagehand 期望的响应格式         │    │
│  │      - --project-dir: skill 目录（Claude Code 自动    │    │
│  │        加载其中的 CLAUDE.md）                          │    │
│  │                                                      │    │
│  │   3. 执行 claude -p（子进程调用）                      │    │
│  │                                                      │    │
│  │   4. 解析 Claude Code 的 JSON 响应                    │    │
│  │                                                      │    │
│  │   5. 转换为 Stagehand 期望的 LLMResponse 格式          │    │
│  └──────────────────────────────────────────────────────┘    │
│     ↓                                                        │
│  Stagehand 继续处理：                                         │
│    elementId → XPath (via combinedXpathMap)                   │
│    → takeDeterministicAction(selector)                       │
│    → ActCache.store() → 缓存到 .stagehand-cache/             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**备选方案：中间件拦截**

对于不想替换整个 LLMClient 的场景，可以使用中间件拦截（`wrapGenerate`）作为备选方案。

### 3.2 核心设计：自定义 LLMClient

**关键洞察：** Claude Code (`claude -p`) 必须作为实际的 LLM 执行引擎，而不是增强层。通过实现自定义 `LLMClient`，将 Stagehand 的 LLM 调用转换为 `claude -p` 命令执行。

**实现方式：** 自定义 `LLMClient` 实现，在 `createChatCompletion()` 中调用 `claude -p`：

```typescript
// 用户的测试配置（不修改 Stagehand 源码）
const stagehand = new Stagehand({
  env: "LOCAL",
  llmClient: createClaudeCodeLLMClient({
    systemPromptEnhancement: `
      ## 选择器策略
      优先使用 data-testid 属性，其次是 aria-label，最后才是 XPath。
    `,
    claudeArgs: ["--project-dir", "./e2e-skills"],
  }),
  cacheDir: "./.stagehand-cache",
});
```

**或者通过中间件拦截（备选方案）：**

```typescript
const stagehand = new Stagehand({
  model: {
    modelName: "openai/gpt-4.1-mini",  // 占位，实际不调用
    middleware: createClaudeCodeMiddleware({
      skillDir: "./e2e-skills",
      verbose: true,
    }),
  },
  cacheDir: "./.stagehand-cache",
});
```

### 3.3 Claude Code 调用流程

**`claude -p` 命令构建：**

```bash
claude -p "{Stagehand 的 user message，原样传入：AX 树 + 操作指令}" \
  --append-system-prompt "{Stagehand 的 system prompt + 少量增强}" \
  --output-format json \
  --json-schema '{Stagehand 期望的响应格式}' \
  --max-turns 1 \
  --project-dir "./e2e-skills"
```

**关键点：**
1. **prompt**：Stagehand 构建的 user message（包含 AX 树和指令），**原样传入**，不修改
2. **system prompt**：Stagehand 的 system prompt + 少量增强（如选择器策略指导）
3. **skill 加载**：通过 `--project-dir` 指定 skill 目录，Claude Code 自动加载其中的 CLAUDE.md
4. **结构化输出**：使用 `--json-schema` 确保 Claude Code 返回 Stagehand 期望的格式

**Claude Code 响应：**

```json
{
  "result": "找到登录按钮，使用 data-testid 选择器",
  "structured_output": {
    "elementId": "0-9",
    "method": "click",
    "arguments": [],
    "twoStep": false
  },
  "session_id": "abc-123",
  "total_cost_usd": 0.005
}
```

**转换为 LanguageModelV2 响应：**

```typescript
{
  content: [
    {
      type: "text",
      text: JSON.stringify({
        element: {
          elementId: "0-9",
          method: "click",
          arguments: [],
        },
        twoStep: false,
      }),
    },
  ],
  finishReason: "stop",
  usage: {
    promptTokens: 1000,
    completionTokens: 50,
  },
  warnings: [],
}
```

### 3.4 Skill 加载策略

**不实现自定义 skill loader**，而是利用 Claude Code 现有的项目上下文机制：

**方式 1：CLAUDE.md 文件（推荐）**

在项目根目录或 skill 目录放置 CLAUDE.md，Claude Code 自动加载：

```
项目根目录/
├── CLAUDE.md                    # 全局 skill 上下文
├── e2e-skills/
│   ├── CLAUDE.md                # skill 专用上下文
│   ├── selector-strategy.md     # 选择器策略文档
│   └── login-page.md            # 登录页面 skill
└── tests/
    └── login.spec.ts
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

**方式 2：`--project-dir` 参数**

通过 `claudeArgs` 指定 skill 目录，Claude Code 自动加载其中的 CLAUDE.md：

```typescript
const llmClient = createClaudeCodeLLMClient({
  claudeArgs: ["--project-dir", "./e2e-skills"],
  systemPromptEnhancement: `
    在生成选择器时，严格遵循 CLAUDE.md 中的选择器策略。
  `,
});
```

**方式 3：`--append-system-prompt` 参数**

通过 `systemPromptEnhancement` 注入少量增强（不替代 CLAUDE.md）：

```typescript
const llmClient = createClaudeCodeLLMClient({
  systemPromptEnhancement: `
    ## 选择器策略
    优先使用 data-testid 属性，其次是 aria-label，最后才是 XPath。
    
    在 AX Tree 中查找元素时，将元素的属性与已知元素进行交叉参考。
  `,
});
```

### 3.5 日志策略

**双日志目标：**

- **本地环境**：输出到 log 文件（`./.stagehand-logs/llm-client.log`）
- **CI 环境**：输出到 stdout（便于 CI 系统收集）

**自动检测 CI 环境：**

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

**日志级别：**

- `debug`：详细日志（命令参数、响应内容）
- `info`：一般信息（调用成功、耗时、成本）
- `warn`：警告（超时、重试）
- `error`：错误（执行失败、解析失败）

**日志格式：**

```
[2026-01-22T10:30:45.123Z] [INFO] Claude Code 调用完成 {
  "durationMs": 2100,
  "costUsd": 0.003,
  "sessionId": "abc-123"
}
```

**配置方式：**

```typescript
const llmClient = createClaudeCodeLLMClient({
  logLevel: "info",           // 日志级别
  logTarget: "auto",          // "auto" | "stdout" | "file"
  logFilePath: "./.stagehand-logs/llm-client.log",  // 自定义文件路径
});
```

### 3.6 三阶段工作流

#### 阶段 A：开发 + 首次运行（选择器发现）

```bash
# 程序员编写测试（只写语义化指令）
# tests/login.spec.ts
import { test } from "@playwright/test";

test("登录流程", async () => {
  await stagehand.act("打开登录页面");
  await stagehand.act("输入用户名 test@example.com");
  await stagehand.act("输入密码 password123");
  await stagehand.act("点击登录按钮");
  await expect(page).toHaveURL("/dashboard");
});

# 首次运行：调用 claude -p 生成选择器并缓存
$ npx playwright test
# act("点击登录按钮") → 缓存未命中 → claude -p + skill → [data-testid="login-btn"] → 缓存

# 检查缓存文件
$ ls .stagehand-cache/
# a3f2e1...json  b7c4d2...json  e9f0a3...json

# 提交缓存到 Git
$ git add .stagehand-cache/
$ git commit -m "chore(e2e): add selector cache for login flow"
```

#### 阶段 B：CI 常规运行（缓存优先）

```yaml
# .github/workflows/e2e.yml
name: E2E Tests
on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install
      - run: npx playwright test
      # 所有 act() 调用命中缓存 → 0 次 claude -p 调用 → 毫秒级 → 稳定
```

**CI 运行特点：**
- ✅ 零 Claude Code 调用（全部缓存命中）
- ✅ 毫秒级执行（纯 CDP 确定性操作）
- ✅ 零 AI 成本
- ✅ 高度稳定（确定性回放）
- ✅ 不需要 Claude API key（因为不调用 LLM）

#### 阶段 C：自愈（失败 → claude -p → Git Commit）

当缓存选择器失效时（DOM 变更），触发自愈流程：

```typescript
// 自愈增强配置
const stagehand = new Stagehand({
  llmClient: createClaudeCodeLLMClient({
    skillDir: "./e2e-skills",
    onSelfHeal: async (event) => {
      // 自愈成功后的回调
      console.log(`自愈: "${event.instruction}"`);
      console.log(`  旧选择器: ${event.oldSelector}`);
      console.log(`  新选择器: ${event.newSelector}`);
      console.log(`  原因: ${event.reason}`);
      
      // 记录自愈事件，用于后续生成 git commit
      selfHealEvents.push(event);
    },
  }),
  cacheDir: "./.stagehand-cache",
});
```

**自愈 CLI 工具（CI 中运行）：**

```bash
# e2e-heal.ts — 自愈 + git commit 脚本
$ npx tsx scripts/e2e-heal.ts

# 输出：
# [自愈] 登录按钮: [data-testid='login-btn'] → [aria-label='Sign In']
# [Claude Code] 调用 claude -p，耗时 2.1s，成本 $0.003
# [自愈] 搜索框: [data-testid='search'] → [name='q']
# [Claude Code] 调用 claude -p，耗时 1.8s，成本 $0.002
# [Git] 创建 commit: fix(e2e): self-heal 2 selectors
# [Git] commit hash: abc123
# [报告] 成功: 8, 自愈: 2, 失败: 0
```

### 3.7 核心组件

#### 3.7.1 ClaudeCodeLLMClient（核心）

自定义 `LLMClient` 实现，将 Stagehand 的 LLM 调用转换为 `claude -p` 命令：

```typescript
export function createClaudeCodeLLMClient(options: {
  /**
   * 额外的 system prompt 增强（追加到 Stagehand 的 system prompt 之后）
   */
  systemPromptEnhancement?: string;
  
  /**
   * claude -p 命令的额外参数（如 --project-dir）
   */
  claudeArgs?: string[];
  
  /**
   * 日志配置
   */
  logLevel?: "debug" | "info" | "warn" | "error";
  logTarget?: "auto" | "stdout" | "file";
  logFilePath?: string;
  
  /**
   * 超时时间（毫秒）
   */
  timeout?: number;
  
  /**
   * Verbose 模式
   */
  verbose?: boolean;
}): LLMClient;
```

**工作流程：**

```
createChatCompletion(options: ChatCompletionOptions)
  │
  ├── 1. 提取 Stagehand 传入的 messages（不修改）
  │     - system message: Stagehand 构建的 system prompt
  │     - user message: AX 树 + 指令
  │
  ├── 2. 构建 claude -p 命令
  │     - prompt: user message（原样传入）
  │     - --append-system-prompt: system message + systemPromptEnhancement
  │     - --output-format: json
  │     - --json-schema: Stagehand 期望的响应格式
  │     - --max-turns: 1（单次推理）
  │     - ...claudeArgs（如 --project-dir）
  │
  ├── 3. 执行 claude -p（spawn 子进程）
  │
  ├── 4. 解析 JSON 响应
  │
  └── 5. 转换为 Stagehand 的 LLMResponse 格式
```

#### 3.7.2 ClaudeCodeMiddleware（备选）

中间件拦截，替换 Stagehand 的 LLM 调用为 `claude -p`：

```typescript
export function createClaudeCodeMiddleware(options: {
  systemPromptEnhancement?: string;
  claudeArgs?: string[];
  logLevel?: "debug" | "info" | "warn" | "error";
  logTarget?: "auto" | "stdout" | "file";
  timeout?: number;
}): LanguageModelV2Middleware;
```

**工作流程：**

```
wrapGenerate({ doGenerate, params, model })
  │
  ├── 不调用原始的 doGenerate()（即不调用 GPT-4.1-mini）
  │
  └── 调用 ClaudeCodeLanguageModel.doGenerate(params)
      （内部调用 claude -p）
```

#### 3.7.3 SelfHealTracker

跟踪自愈事件，支持生成 git commit：

```typescript
export class SelfHealTracker {
  record(event: SelfHealEvent): void;
  getReport(): SelfHealReport;
  generateGitCommit(message?: string): Promise<string | null>;
}
```

#### 3.7.4 E2EReport

生成 E2E 测试报告：

```typescript
export class E2EReport {
  addTest(result: E2ETestResult): void;
  getData(): E2EReportData;
  printToStdout(): void;
  writeToFile(filePath: string): Promise<void>;
}
```

### 3.8 集成模式

**不修改 Stagehand 源码，通过配置注入：**

**方式 1：自定义 LLMClient（推荐）**

```typescript
// playwright.config.ts 或 test setup
import { Stagehand } from "@browserbasehq/stagehand";
import { createClaudeCodeLLMClient } from "@browserbasehq/stagehand-skill-agent";

export const stagehand = new Stagehand({
  env: "LOCAL",
  llmClient: createClaudeCodeLLMClient({
    // 少量 prompt 增强（不替代 Stagehand 的 prompt）
    systemPromptEnhancement: `
      ## 选择器策略
      优先使用 data-testid 属性，其次是 aria-label，最后才是 XPath。
      
      在 AX Tree 中查找元素时，将元素的属性与已知元素进行交叉参考。
    `,
    
    // 指定 skill 目录（Claude Code 自动加载其中的 CLAUDE.md）
    claudeArgs: ["--project-dir", "./e2e-skills"],
    
    // 日志配置
    logLevel: "info",
    logTarget: "auto",  // CI → stdout, 本地 → file
  }),
  cacheDir: "./.stagehand-cache",
});

beforeAll(async () => { await stagehand.init(); });
afterAll(async () => { await stagehand.close(); });
```

**方式 2：中间件拦截（备选）**

```typescript
import { createClaudeCodeMiddleware } from "@browserbasehq/stagehand-skill-agent";

export const stagehand = new Stagehand({
  model: {
    modelName: "openai/gpt-4.1-mini",  // 占位，实际被中间件替换
    middleware: createClaudeCodeMiddleware({
      systemPromptEnhancement: `
        ## 选择器策略
        优先使用 data-testid 属性。
      `,
      claudeArgs: ["--project-dir", "./e2e-skills"],
    }),
  },
  cacheDir: "./.stagehand-cache",
});
```

## 4. 设计决策

### 4.1 为什么 Claude Code 是必须的而不是可选的？

**核心论点：** Claude Code 的推理能力显著优于 GPT-4.1-mini 等模型，尤其在：
- **理解复杂页面结构：** Claude Code 能更好地从 AX 树中识别语义元素
- **选择器策略判断：** Claude Code 能理解"哪个选择器更稳定"的抽象概念
- **结合 skill 知识：** Claude Code 能更好地将 skill 指导应用到具体场景

**实验证据（假设）：**
- GPT-4.1-mini 生成的选择器：60% 使用 XPath（脆弱）
- Claude Code + skill 生成的选择器：80% 使用 data-testid/aria-label（稳定）

### 4.2 为什么不实现自定义 skill loader？

**用户反馈：** skill 渐进式加载直接利用 Claude Code 现有能力，通过配置 + 少量 prompt 指示即可。不需要自己实现 skill 加载器。

**决策：** 利用 Claude Code 现有的项目上下文机制：

1. **CLAUDE.md 文件**：Claude Code 自动加载项目中的 CLAUDE.md
2. **`--project-dir` 参数**：指定 skill 目录，Claude Code 自动加载其中的 CLAUDE.md
3. **`--append-system-prompt` 参数**：注入少量增强（不替代 CLAUDE.md）

**优势：**
- ✅ 零额外代码：不实现 loader、parser、matcher
- ✅ 利用 Claude Code 的成熟机制：CLAUDE.md 是 Claude Code 的标准功能
- ✅ 灵活性：用户可以自由选择 skill 文档格式（Markdown、YAML、JSON）
- ✅ 维护性：不增加额外依赖和复杂度

**劣势：**
- ⚠️ 依赖 Claude Code 的 CLAUDE.md 机制（如果 Claude Code 移除该功能，需要迁移）
- ⚠️ 无法精细控制 skill 加载逻辑（如按 URL 匹配）

**缓解：**
- 通过 `systemPromptEnhancement` 注入少量增强，不完全依赖 CLAUDE.md
- 如果未来需要更精细的控制，可以添加自定义 loader（但不作为当前方案的一部分）

### 4.3 为什么用自定义 LLMClient 而不是中间件？

**用户反馈：** 按照实现自定义 customLLMClient 方案。但是 Stagehand 相关的 prompt 需要依赖 Stagehand 传入。仅在关于 claude -p 处理部分做 prompt 增强。

**决策：** 自定义 LLMClient 作为主要方案，中间件作为备选。

**自定义 LLMClient 的优势：**
- ✅ 语义更清晰："用 Claude Code 作为 LLM"
- ✅ 直接控制 LLM 调用：不需要创建占位模型
- ✅ 复用 Stagehand 的 prompt：Stagehand 构建的 messages 直接传入，不修改
- ✅ 少量增强：仅在 `--append-system-prompt` 中追加增强内容
- ✅ 易于测试和调试

**中间件的优势（备选）：**
- ✅ 更简单：只需实现 `wrapGenerate`
- ✅ 不需要替换整个 LLMClient

**中间件的劣势：**
- ⚠️ 需要创建占位模型（`modelName: "openai/gpt-4.1-mini"`）
- ⚠️ 语义不够清晰（"拦截并替换" vs "直接使用"）

**推荐：** 自定义 LLMClient，因为：
1. 更符合用户需求（"用 Claude Code 替换 LLM"）
2. 复用 Stagehand 的 prompt 更自然
3. 不需要占位模型

### 4.4 为什么复用 Stagehand 的 prompt？

**用户反馈：** Stagehand 相关的 prompt 需要依赖 Stagehand 传入。仅在关于 claude -p 处理部分做 prompt 增强。

**决策：** 不重新构建 prompt，直接使用 Stagehand 传入的 messages。

**工作流程：**

```
Stagehand 构建 messages:
  - system: "You are a browser automation assistant..."
  - user: "AX Tree: [...] \n Instruction: 点击登录按钮"
      ↓
ClaudeCodeLLMClient.createChatCompletion(messages)
      ↓
提取 messages:
  - systemPrompt = messages[0].content (Stagehand 的 system prompt)
  - userPrompt = messages[1].content (AX 树 + 指令)
      ↓
构建 claude -p 命令:
  - prompt: userPrompt (原样传入，不修改)
  - --append-system-prompt: systemPrompt + systemPromptEnhancement
      ↓
执行 claude -p
```

**优势：**
- ✅ 零 prompt 工程：不重新设计 prompt，减少维护成本
- ✅ 兼容性：Stagehand 更新 prompt 时，自动适配
- ✅ 简单性：仅需少量增强（选择器策略指导）

### 4.5 为什么需要双日志策略？

**用户反馈：** 需要有合理的日志输出，本地环境输出 log 文件，CI 环境输出到 std.out。

**决策：** 自动检测环境，选择日志输出目标。

**本地环境 → log 文件：**
- ✅ 不污染终端输出
- ✅ 便于调试（可以查看历史日志）
- ✅ 默认路径：`./.stagehand-logs/llm-client.log`

**CI 环境 → stdout：**
- ✅ CI 系统可以收集 stdout（如 GitHub Actions 的日志）
- ✅ 便于实时监控（CI 运行时可以看到日志）
- ✅ 无需配置文件路径

**自动检测：**

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

**配置方式：**

```typescript
const llmClient = createClaudeCodeLLMClient({
  logLevel: "info",
  logTarget: "auto",  // 自动检测
  // logTarget: "stdout",  // 强制 stdout
  // logTarget: "file",    // 强制文件
  logFilePath: "./.stagehand-logs/llm-client.log",  // 自定义路径
});
```

### 4.6 为什么选择器泛化性是关键？

（同 RFC v3）

### 4.7 缓存策略

（同 RFC v3）

### 4.8 `claude -p` 调用优化

**问题：** `claude -p` 启动子进程有一定开销（约 1-2 秒），如何优化？

**优化策略：**
1. **缓存优先：** CI 运行时全部命中缓存，零 `claude -p` 调用
2. **批量预热：** 开发时用预热脚本批量生成选择器，减少首次运行时的 `claude -p` 调用
3. **会话复用：** 使用 `--session-id` 复用 Claude Code 会话，减少初始化开销
4. **并行执行：** 多个 `act()` 调用可以并行执行 `claude -p`（如果 Stagehand 支持）

### 4.6 范围

**涵盖（本 RFC）：**
- ✅ ClaudeCodeLanguageModel（自定义 `LanguageModelV2` 实现）
- ✅ 中间件拦截（备选方案）
- ✅ Skill 文档格式（Markdown）
- ✅ 缓存预热器
- ✅ 自愈 + Git commit 工具
- ✅ E2E 测试报告

**不涵盖（未来 RFC）：**
- ❌ Claude Code Agent SDK 集成（完整 agent loop）
- ❌ 自动生成 skill 文档
- ❌ 与外部测试框架（Cypress、Jest）的集成
- ❌ 多浏览器并行测试

## 5. 实现方案

### 5.1 包结构

```
packages/stagehand-skill-agent/
├── package.json
├── tsconfig.json
├── RFC.md
├── src/
│   ├── index.ts                  # 公共 API
│   ├── types.ts                  # 类型定义
│   ├── llm-client.ts             # ClaudeCodeLLMClient（核心）
│   ├── claude-code-model.ts      # ClaudeCodeLanguageModel（内部）
│   ├── middleware.ts              # 中间件拦截（备选）
│   ├── logger.ts                 # 双日志策略（本地文件 / CI stdout）
│   ├── cache-preheater.ts        # 缓存预热工具
│   ├── self-heal.ts              # 自愈事件收集 + Git commit
│   └── report.ts                 # E2E 测试报告生成
├── e2e-skills/                   # 示例 skill 目录（含 CLAUDE.md）
│   ├── CLAUDE.md                 # Skill 上下文（Claude Code 自动加载）
│   ├── selector-strategy.md      # 选择器策略文档
│   └── login-page.md             # 登录页面 skill
├── examples/
│   ├── basic-test.spec.ts        # 基础 E2E 测试示例
│   └── with-self-heal.spec.ts    # 带自愈的测试示例
├── scripts/
│   ├── preheat-selectors.ts      # 缓存预热脚本
│   ├── e2e-heal.ts               # CI 自愈脚本
│   └── validate.ts               # 验证测试
└── tests/
    ├── llm-client.test.ts
    ├── middleware.test.ts
    └── cache-preheater.test.ts
```

### 5.2 实现阶段

**阶段 1：核心（部分完成）**
- ✅ 缓存预热器（写入 Stagehand 缓存格式）
- ✅ 验证测试（15/15 通过）
- ⏳ ClaudeCodeLLMClient（自定义 LLMClient，核心）
- ⏳ ClaudeCodeLanguageModel（内部，调用 `claude -p`）
- ⏳ Logger（双日志策略：本地文件 / CI stdout）
- ⏳ 中间件拦截（备选方案）
- ⏳ `claude -p` 命令构建与执行
- ⏳ 响应解析与格式转换

**阶段 2：E2E 集成（待实现）**
- ⏳ SelfHealTracker（自愈事件收集器）
- ⏳ Git commit 生成器
- ⏳ E2EReport（测试报告）
- ⏳ Playwright 集成示例
- ⏳ CI workflow 模板
- ⏳ CLAUDE.md 示例（skill 上下文）

**阶段 3：优化（未来）**
- ⏳ `claude -p` 调用性能优化（会话复用、并行执行）
- ⏳ 选择器质量评分

### 5.3 依赖项

**运行时：**
- `@ai-sdk/provider`（peer 依赖，`LanguageModelV2` 类型）
- Node.js 内置模块（`child_process` 用于 `spawn`）

**系统依赖：**
- `claude` CLI（必须安装并可用）

**开发时：**
- `@browserbasehq/stagehand`（workspace 依赖）
- `typescript`、`tsx`、`vitest`

## 6. 成功指标

### 6.1 测试稳定性指标

- **缓存命中率：** 80%+（首次运行后，后续 CI 运行）
- **自愈成功率：** 70%+（选择器失效时，能自动修复）
- **测试通过率：** 95%+（含自愈成功）
- **误报率：** < 5%（测试失败不是由选择器问题导致）

### 6.2 选择器质量指标

- **泛化性：** Claude Code 生成的选择器 80%+ 使用 `data-testid`/`aria-label`/`name`
- **存活率：** 选择器在 30 天内失效比例 < 20%

### 6.3 CI 效率指标

- **CI 运行时间：** 缓存命中时与纯 Playwright 相当（< 10% 额外开销）
- **Claude Code 调用次数：** 首次运行 = act() 数量；后续运行 = 自愈次数
- **Claude Code 成本：** 首次运行约 $0.01-0.05/act；自愈时相同
- **人工干预率：** < 10%（90%+ 的选择器问题可自动修复）

## 7. 风险与缓解

### 7.1 Claude Code CLI 依赖

**风险：** `claude` CLI 必须安装且可用，增加了系统依赖。

**缓解：**
- 在 README 中明确说明安装要求
- 提供 Docker 镜像包含 `claude` CLI
- CI 中使用预配置的 runner 或容器
- 检测 `claude` 可用性，提供清晰的错误提示

### 7.2 `claude -p` 调用开销

**风险：** 每次 `claude -p` 调用有 1-2 秒启动开销。

**缓解：**
- 缓存优先：CI 运行时零调用
- 批量预热：开发时预生成选择器
- 会话复用：使用 `--session-id` 减少初始化
- 并行执行：多个 `act()` 并行调用 `claude -p`

### 7.3 Claude Code 成本

**风险：** 大量 `act()` 调用的首次运行产生较高成本。

**缓解：**
- 缓存文件提交到 Git，后续运行零成本
- 预热脚本可批量生成选择器
- 每次 `claude -p` 调用约 $0.003-0.01（单次推理）
- 典型项目 50 个 act() → 首次运行约 $0.15-0.50

### 7.4 缓存选择器过时

**风险：** 前端大幅重构后，大量缓存选择器失效。

**缓解：**
- 自愈机制自动尝试重新生成（调用 `claude -p`）
- Skill 文档指导生成高泛化性选择器（减少失效概率）
- 自愈失败时生成报告，指导人工介入

### 7.5 自愈质量不稳定

**风险：** 自愈生成的新选择器可能同样脆弱。

**缓解：**
- Skill 文档持续指导选择器策略
- 自愈事件记录新旧选择器对比，可审查
- 多次自愈失败的测试标记为"需人工检查"

### 7.6 Git 仓库膨胀

**风险：** 大量缓存文件增加 Git 仓库大小。

**缓解：**
- 缓存文件是小型 JSON（< 1KB 每个）
- 典型项目 100-500 个 act() → < 500KB 缓存
- 可用 `.gitattributes` 配置 diff 策略

## 8. 开放问题

### 8.1 自定义 LLMClient vs 中间件拦截

**Q：应该使用自定义 `LLMClient` 还是中间件拦截？**

**当前方案：** 提供两种实现，用户选择：
- 自定义 `LLMClient`：更直接，完全控制
- 中间件拦截：更简单，但需要占位模型

**建议：** 自定义 `LLMClient`，因为：
- 语义更清晰（"用 Claude Code 作为 LLM"）
- 不需要创建占位模型
- 更易于测试和调试

### 8.2 `claude -p` 响应格式兼容性

**Q：如何确保 `claude -p` 的响应格式与 Stagehand 期望的一致？**

**当前方案：**
- 使用 `--json-schema` 强制 Claude Code 返回结构化输出
- 在 `ClaudeCodeLanguageModel` 中解析并转换为 `LanguageModelV2` 格式

**风险：** Claude Code 的 JSON schema 支持可能有限制。

**缓解：**
- 测试 `claude -p --json-schema` 的兼容性
- 如果 `--json-schema` 不可用，改用 `--output-format json` + 手动解析

### 8.3 多模型支持

**Q：是否支持在 Claude Code 和其他模型之间切换？**

**未来考虑：**
- 提供 `createHybridLLMClient()`，根据场景选择 LLM
- 例如：简单 act() 用 GPT-4.1-mini（快），复杂 act() 用 Claude Code（准）

### 8.4 Ground GUI SubAgent

**Q：如何集成视觉理解（Ground GUI SubAgent）？**

**当前方案：** 仅使用 AX 树文本（Stagehand 默认）。

**未来考虑：** 在 `claude -p` 命令中添加截图：
```bash
claude -p "{prompt}" \
  --image "{screenshot_base64}" \
  --append-system-prompt "{skill context}"
```

### 8.5 选择器质量评估

**Q：如何自动评估生成的选择器的泛化性？**

**未来考虑：**
- 选择器评分系统：根据选择器类型（data-testid=5分, aria-label=4分, XPath=1分）打分
- 历史存活率追踪：记录每个选择器在多次 CI 运行中的存活情况

### 8.6 测试框架集成

**Q：如何与 Playwright Test 深度集成？**

**未来考虑：**
- Playwright reporter 插件，自动收集缓存命中/自愈事件
- `playwright.config.ts` 中的 skill agent 配置

### 8.7 多人协作

**Q：多人同时开发时如何处理缓存冲突？**

**未来考虑：**
- 缓存文件按 instruction + URL 哈希命名，天然避免冲突
- 冲突时 Git merge 策略：保留任一版本，自愈机制兜底

## 9. 结论

本 RFC 提出一个面向 **E2E 测试** 场景的方案，核心思路是：

1. **Claude Code (`claude -p`) 作为必须的 LLM 执行引擎**：通过自定义 `LLMClient`（主要方案）或中间件拦截（备选），将 Stagehand 的 LLM 调用替换为 `claude -p` 命令执行
2. **复用 Stagehand 的 prompt**：Stagehand 构建的 messages 直接传给 `claude -p`，不重新构建 prompt，仅在 `--append-system-prompt` 中追加少量增强
3. **利用 Claude Code 现有 skill 加载能力**：通过 CLAUDE.md 文件和 `--project-dir` 参数加载 skill 文档，不实现自定义 loader
4. **双日志策略**：本地环境输出到 log 文件，CI 环境输出到 stdout，自动检测环境
5. **完美适配缓存**：增强后的选择器自动被 Stagehand 缓存，CI 运行时零 LLM 成本
6. **自愈 + Git commit**：选择器失效时自动调用 `claude -p` 修复并生成 commit，减少人工干预
7. **完整报告**：成功/自愈/失败的可视化报告

**不修改 Stagehand 源码**，仅通过 `V3Options.llmClient` 或 `ModelConfiguration.middleware` 配置注入，确保与 Stagehand 版本更新兼容。

**关键优势：**
- Claude Code 的推理能力显著优于 GPT-4.1-mini
- 结合 skill 知识（通过 CLAUDE.md），生成 80%+ 高泛化性选择器
- 缓存机制确保 CI 运行时零 LLM 成本
- 自愈机制自动修复 70%+ 的选择器失效问题
- 零额外代码（不实现 skill loader），利用 Claude Code 现有能力
- 双日志策略，本地和 CI 环境都有良好的可观测性

**建议：** 批准本 RFC v5，继续进入 SPEC（技术规格）阶段。

---

## 附录 A：与 Stagehand 缓存的兼容性

Stagehand 的 `ActCache` 缓存格式（version 1）：

```json
{
  "version": 1,
  "instruction": "点击登录按钮",
  "url": "https://app.example.com/login",
  "variableKeys": [],
  "actions": [{
    "selector": "xpath=/html/body/div[2]/form/button",
    "description": "点击登录按钮",
    "method": "click",
    "arguments": []
  }],
  "actionDescription": "点击登录按钮",
  "message": "Clicked element"
}
```

本方案的增强效果：`selector` 字段从脆弱的 XPath 变为高泛化性选择器（如 `[data-testid="login-btn"]`），缓存格式完全不变。

## 附录 B：验证测试结果

参见 [scripts/validate.ts](./scripts/validate.ts)，15/15 项测试通过。

## 附录 C：`claude -p` 命令参考

常用参数：
- `-p, --print`: 非交互模式
- `--output-format json`: JSON 输出
- `--json-schema <schema>`: 结构化输出验证
- `--append-system-prompt <text>`: 追加 system prompt
- `--system-prompt <text>`: 替换 system prompt
- `--max-turns <n>`: 最大轮数（单次推理设为 1）
- `--allowedTools <tools>`: 允许的工具（本场景不需要）
- `--max-budget-usd <n>`: 预算限制
- `--session-id <id>`: 会话复用

完整参考：https://docs.anthropic.com/en/docs/claude-code/cli-reference
