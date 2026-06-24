# @browserbasehq/stagehand-skill-agent

**使用 Claude Code 作为 Stagehand E2E 测试的 LLM 执行引擎。**

[English](./README.md) | [中文](./README.zh-CN.md)

---

## 这是什么？

`@browserbasehq/stagehand-skill-agent` 是一个为 [Stagehand](https://github.com/browserbase/stagehand) 定制的 `LLMClient`，用 **Claude Code** (`claude -p`) 替换默认 LLM。它将业务 skill 知识与 Claude Code 的推理能力结合，为 E2E 测试生成高质量、高泛化性的选择器。

## 为什么需要它？

Stagehand 默认 LLM（GPT-4.1-mini）生成的选择器往往很脆弱（XPath、带 hash 的 CSS class），前端每次重构都会大面积失效。本包通过以下方式解决：

1. **更优的选择器质量** — Claude Code + skill 文档生成的选择器使用 `data-testid` 和 `aria-label`（约 80%），能经受住前端重构。
2. **CI 零成本** — 选择器在首次运行时缓存并提交到 Git，CI 运行为纯确定性 CDP 回放，零 LLM 调用。
3. **自愈能力** — 缓存选择器失效时，Claude Code 自动重新生成并创建修复 commit。

## 工作原理

```
开发者编写:          stagehand.act("点击登录按钮")
                              │
                              ▼
首次运行:            Claude Code + skill 文档 → [data-testid="login-btn"] → 缓存
                              │
                              ▼
CI 运行:             缓存命中 → 确定性 CDP 执行（0ms LLM，$0 成本）
                              │
                              ▼
选择器失效:          Claude Code 重新生成 → [aria-label="Sign In"] → git commit
```

## 安装

```bash
npm install @browserbasehq/stagehand-skill-agent
```

**前置要求：**
- Node.js >= 18
- `claude` CLI 已安装并在 PATH 中可用
- `@browserbasehq/stagehand` >= 3.6.0

## 快速开始

```typescript
import { Stagehand } from "@browserbasehq/stagehand";
import { createClaudeCodeLLMClient } from "@browserbasehq/stagehand-skill-agent";

const stagehand = new Stagehand({
  env: "LOCAL",
  llmClient: createClaudeCodeLLMClient({
    systemPromptEnhancement: `
      优先使用 data-testid 属性，其次是 aria-label，最后才是 XPath。
    `,
    claudeArgs: ["--project-dir", "./e2e-skills"],
    logLevel: "info",
  }),
  cacheDir: "./.stagehand-cache",
});

await stagehand.init();
const page = stagehand.context.pages()[0];
await page.goto("https://app.example.com/login");

// 语义化操作 — 不需要写选择器
await stagehand.act("输入用户名 test@example.com");
await stagehand.act("输入密码 password123");
await stagehand.act("点击登录按钮");

await stagehand.close();
```

## Skill 配置

在 skill 目录中放置 `CLAUDE.md` 来指导选择器生成：

```markdown
# E2E Testing Skill Context

## 选择器策略
1. 优先使用 `data-testid`（如 `[data-testid="login-btn"]`）
2. 其次使用 `aria-label`
3. 再次使用 ARIA `role` + 可访问名称
4. 避免使用带 hash 后缀的 CSS class

## 已知元素
- 登录按钮: `[data-testid="login-btn"]` 或 `[aria-label="Sign in"]`
- 用户名输入: `[data-testid="email-input"]` 或 `[name="email"]`
```

## API 参考

### `createClaudeCodeLLMClient(options?)`

创建用于 Stagehand 的自定义 `LLMClient`。

| 选项 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `systemPromptEnhancement` | `string` | `""` | 追加到 Stagehand system prompt 的额外指令 |
| `claudeArgs` | `string[]` | `[]` | 额外的 `claude -p` CLI 参数 |
| `logLevel` | `"debug" \| "info" \| "warn" \| "error"` | `"info"` | 日志级别 |
| `logTarget` | `"auto" \| "stdout" \| "file"` | `"auto"` | 日志目标（自动检测 CI/本地环境） |
| `logFilePath` | `string` | `"./.stagehand-logs/llm-client.log"` | `logTarget="file"` 时的日志文件路径 |
| `onSelfHeal` | `(event: SelfHealEvent) => void` | — | 自愈事件回调 |
| `timeout` | `number` | `30000` | Claude Code 调用超时时间（毫秒） |

### `SelfHealTracker`

跟踪自愈事件并生成 git commit。

```typescript
import { SelfHealTracker } from "@browserbasehq/stagehand-skill-agent";

const tracker = new SelfHealTracker({ cacheDir: "./.stagehand-cache" });
tracker.record(event);

const report = tracker.getReport();
const commitHash = await report.generateGitCommit("fix(e2e): self-heal selectors");
```

### `E2EReport`

生成 E2E 测试报告。

```typescript
import { E2EReport } from "@browserbasehq/stagehand-skill-agent";

const report = new E2EReport();
report.addTest(result);
report.printToStdout();
await report.writeToFile("./e2e-report.json");
```

## 示例

查看 [examples/](examples/) 目录：

| 示例 | 描述 |
|------|------|
| [basic-test](examples/basic-test/) | 基础 E2E 测试，使用语义化操作 |
| [self-heal](examples/self-heal/) | 选择器失效时的自愈演示 |
| [preheat-selectors](examples/preheat-selectors/) | 批量预生成并缓存选择器 |

## CI 集成

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
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
        env:
          CI: true
```

CI 运行完全使用缓存选择器 — 零 Claude Code 调用、零成本、毫秒级执行。

## 许可证

MIT
