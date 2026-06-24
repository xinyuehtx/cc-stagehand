# User Stories, Demo & Test Cases

**版本：** 1.0  
**日期：** 2026-01-22  
**依赖：** SPEC v1.0（已批准）

---

## 1. User Stories

### US-1: 语义化测试编写

**作为** 开发者  
**我希望** 只写语义化的 `act()` 指令，不需要写选择器  
**以便** 快速编写 E2E 测试，不依赖 DOM 结构知识

**验收标准：**
- 测试代码中只出现 `stagehand.act("点击登录按钮")` 这样的语义化指令
- 不出现 `page.click('#btn-abc123')` 这样的选择器代码
- 测试代码可读性强，非前端开发者也能理解

**示例代码：**
```typescript
test("登录流程", async () => {
  await stagehand.act("打开登录页面");
  await stagehand.act("输入用户名 test@example.com");
  await stagehand.act("输入密码 password123");
  await stagehand.act("点击登录按钮");
  await expect(page).toHaveURL("/dashboard");
});
```

---

### US-2: 首次运行生成选择器

**作为** 开发者  
**我希望** 首次运行测试时，Claude Code 自动生成高质量选择器并缓存  
**以便** 后续运行不需要调用 LLM

**验收标准：**
- 首次运行 `act("点击登录按钮")` 时，调用 `claude -p` 生成选择器
- 生成的选择器使用高泛化性策略（data-testid > aria-label > XPath）
- 选择器写入 `.stagehand-cache/` 目录
- 缓存文件可以提交到 Git

**日志输出（本地）：**
```
[2026-01-22T10:30:45.123Z] [INFO] Claude Code 调用完成 {
  "durationMs": 2100,
  "costUsd": 0.003,
  "sessionId": "abc-123"
}
[2026-01-22T10:30:45.456Z] [INFO] 选择器已缓存 {
  "instruction": "点击登录按钮",
  "selector": "[data-testid='login-btn']",
  "cacheFile": ".stagehand-cache/a3f2e1.json"
}
```

---

### US-3: CI 运行零 LLM 成本

**作为** CI 系统  
**我希望** 运行时全部命中缓存，不调用 Claude Code  
**以便** 测试快速、稳定、零成本

**验收标准：**
- CI 运行时，所有 `act()` 调用命中缓存
- 不调用 `claude -p`
- 执行速度：毫秒级（纯 CDP 确定性操作）
- 日志输出到 stdout（CI 系统可收集）

**日志输出（CI）：**
```
[2026-01-22T10:30:45.123Z] [INFO] 缓存命中 {
  "instruction": "点击登录按钮",
  "selector": "[data-testid='login-btn']",
  "durationMs": 23
}
```

**CI workflow 示例：**
```yaml
name: E2E Tests
on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install
      - run: npx playwright test
      # 全部缓存命中 → 零 Claude Code 调用 → 毫秒级
```

---

### US-4: 自愈 + Git Commit

**作为** 开发者  
**我希望** 选择器失效时自动修复并生成 git commit  
**以便** 减少人工干预，快速恢复测试

**验收标准：**
- 缓存选择器失效时，自动调用 `claude -p` 重新生成
- 新选择器写入缓存（覆盖旧缓存）
- 生成 git commit：`fix(e2e): self-heal selectors`
- Commit 包含新旧选择器对比和失效原因

**自愈日志：**
```
[2026-01-22T10:30:45.123Z] [WARN] 缓存选择器失效 {
  "instruction": "点击登录按钮",
  "oldSelector": "[data-testid='login-btn']",
  "reason": "Element not found"
}
[2026-01-22T10:30:47.456Z] [INFO] 自愈成功 {
  "instruction": "点击登录按钮",
  "oldSelector": "[data-testid='login-btn']",
  "newSelector": "[aria-label='Sign In']",
  "durationMs": 2100,
  "costUsd": 0.003
}
[2026-01-22T10:30:48.789Z] [INFO] Git commit 已创建 {
  "commitHash": "abc123",
  "message": "fix(e2e): self-heal login button selector"
}
```

---

### US-5: E2E 测试报告

**作为** 开发者  
**我希望** 测试结束后生成完整报告  
**以便** 了解测试状态、缓存命中率、自愈事件

**验收标准：**
- 报告包含每个测试的状态（成功/自愈/失败）
- 报告包含缓存命中率统计
- 报告包含自愈事件详情（新旧选择器、成本、commit hash）
- 报告可以输出到 stdout 或文件

**报告示例：**
```
═══════════════════════════════════════════════════
E2E 测试报告
═══════════════════════════════════════════════════

📊 汇总
  总测试数: 4
  ✅ 成功: 2 (50%)
  🔄 自愈: 1 (25%)
  ❌ 失败: 1 (25%)
  缓存命中率: 75%
  Claude Code 调用: 1 次
  Claude Code 成本: $0.003

📝 测试详情

✅ 登录流程 (1.5s)
  - 缓存命中: 4/4
  - Claude Code 调用: 0

✅ 商品搜索 (2.3s)
  - 缓存命中: 3/3
  - Claude Code 调用: 0

🔄 结算流程 (3.2s)
  - 缓存命中: 2/3
  - 自愈: "点击支付按钮"
    ├── 旧: [data-testid='pay']
    ├── 新: [aria-label='Pay']
    ├── Commit: abc123
    └── 成本: $0.003

❌ 用户注册 (失败)
  - 失败: "点击注册按钮"
  - 原因: 页面完全重构，无法匹配
  - 建议: 人工检查并更新 CLAUDE.md

═══════════════════════════════════════════════════
```

---

## 2. Demo 脚本

### Demo-1: 基础 E2E 测试

**场景：** 登录流程测试

**文件：** `examples/basic-test.spec.ts`

```typescript
import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import { createClaudeCodeLLMClient } from "@browserbasehq/stagehand-skill-agent";

const stagehand = new Stagehand({
  env: "LOCAL",
  llmClient: createClaudeCodeLLMClient({
    systemPromptEnhancement: `
      ## 选择器策略
      优先使用 data-testid 属性，其次是 aria-label，最后才是 XPath。
    `,
    claudeArgs: ["--project-dir", "./e2e-skills"],
    logLevel: "info",
  }),
  cacheDir: "./.stagehand-cache",
});

test.beforeAll(async () => {
  await stagehand.init();
});

test.afterAll(async () => {
  await stagehand.close();
});

test("登录流程", async () => {
  const page = stagehand.context.pages()[0];
  
  // 导航到登录页面
  await page.goto("https://app.example.com/login");
  
  // 语义化操作（不写选择器）
  await stagehand.act("输入用户名 test@example.com");
  await stagehand.act("输入密码 password123");
  await stagehand.act("点击登录按钮");
  
  // 验证结果
  await expect(page).toHaveURL("/dashboard");
});
```

**运行命令：**
```bash
# 首次运行（生成选择器 + 缓存）
npx playwright test examples/basic-test.spec.ts

# 查看缓存文件
ls .stagehand-cache/

# 提交缓存到 Git
git add .stagehand-cache/
git commit -m "chore(e2e): add selector cache for login flow"
```

---

### Demo-2: 自愈场景

**场景：** 选择器失效后自动修复

**前置条件：**
- 已有缓存：`[data-testid='login-btn']`
- 前端重构：`data-testid` 被移除，改为 `aria-label="Sign In"`

**文件：** `examples/self-heal-demo.spec.ts`

```typescript
import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import { createClaudeCodeLLMClient, SelfHealTracker } from "@browserbasehq/stagehand-skill-agent";

const tracker = new SelfHealTracker({
  cacheDir: "./.stagehand-cache",
  gitBranch: "fix/e2e-self-heal",
});

const stagehand = new Stagehand({
  env: "LOCAL",
  llmClient: createClaudeCodeLLMClient({
    claudeArgs: ["--project-dir", "./e2e-skills"],
    onSelfHeal: (event) => {
      tracker.record(event);
    },
  }),
  cacheDir: "./.stagehand-cache",
});

test.beforeAll(async () => {
  await stagehand.init();
});

test.afterAll(async () => {
  await stagehand.close();
  
  // 生成自愈报告
  const report = tracker.getReport();
  if (report.totalEvents > 0) {
    console.log(`\n自愈事件: ${report.totalEvents}`);
    console.log(`总成本: $${report.totalCostUsd}`);
    
    // 生成 git commit
    const commitHash = await report.generateGitCommit(
      "fix(e2e): self-heal selectors"
    );
    console.log(`Commit: ${commitHash}`);
  }
});

test("登录流程（自愈场景）", async () => {
  const page = stagehand.context.pages()[0];
  await page.goto("https://app.example.com/login");
  
  // 这个 act() 会触发自愈
  await stagehand.act("点击登录按钮");
  
  await expect(page).toHaveURL("/dashboard");
});
```

**运行命令：**
```bash
# 运行自愈演示
npx playwright test examples/self-heal-demo.spec.ts

# 查看自愈日志
cat .stagehand-logs/llm-client.log

# 查看生成的 git commit
git log --oneline -1
```

---

### Demo-3: CI Workflow

**场景：** CI 环境运行测试（全部缓存命中）

**文件：** `.github/workflows/e2e.yml`

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
      
      - name: Install dependencies
        run: npm install
      
      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium
      
      - name: Run E2E tests
        run: npx playwright test
        env:
          CI: true  # 启用 CI 模式（日志输出到 stdout）
      
      - name: Upload test report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-report
          path: e2e-report.json
```

**预期结果：**
- 全部缓存命中
- 零 Claude Code 调用
- 日志输出到 GitHub Actions 日志
- 测试快速、稳定

---

### Demo-4: 缓存预热脚本

**场景：** 开发时批量生成选择器

**文件：** `scripts/preheat-selectors.ts`

```typescript
import { Stagehand } from "@browserbasehq/stagehand";
import { createClaudeCodeLLMClient } from "@browserbasehq/stagehand-skill-agent";

const stagehand = new Stagehand({
  env: "LOCAL",
  llmClient: createClaudeCodeLLMClient({
    claudeArgs: ["--project-dir", "./e2e-skills"],
    logLevel: "info",
  }),
  cacheDir: "./.stagehand-cache",
});

async function preheat() {
  await stagehand.init();
  
  const page = stagehand.context.pages()[0];
  
  // 登录页面
  await page.goto("https://app.example.com/login");
  await stagehand.act("输入用户名");
  await stagehand.act("输入密码");
  await stagehand.act("点击登录按钮");
  
  // 商品页面
  await page.goto("https://app.example.com/products");
  await stagehand.act("点击搜索框");
  await stagehand.act("输入搜索关键词");
  await stagehand.act("点击搜索按钮");
  
  // 结算页面
  await page.goto("https://app.example.com/checkout");
  await stagehand.act("输入配送地址");
  await stagehand.act("选择支付方式");
  await stagehand.act("点击支付按钮");
  
  await stagehand.close();
  
  console.log("缓存预热完成！");
  console.log("缓存文件:", require("fs").readdirSync("./.stagehand-cache"));
}

preheat().catch(console.error);
```

**运行命令：**
```bash
npx tsx scripts/preheat-selectors.ts

# 提交缓存
git add .stagehand-cache/
git commit -m "chore(e2e): preheat selector cache"
```

---

## 3. Test Cases

### TC-1: ClaudeCodeLLMClient 单元测试

**文件：** `tests/llm-client.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClaudeCodeLLMClient } from "../src/llm-client.js";
import { spawn } from "node:child_process";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

describe("ClaudeCodeLLMClient", () => {
  let client: ReturnType<typeof createClaudeCodeLLMClient>;
  
  beforeEach(() => {
    vi.clearAllMocks();
    client = createClaudeCodeLLMClient({
      systemPromptEnhancement: "优先使用 data-testid",
      claudeArgs: ["--project-dir", "./e2e-skills"],
      logTarget: "stdout",
    });
  });
  
  it("应该提取 Stagehand 的 messages", async () => {
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockReturnValue({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event, cb) => {
        if (event === "close") {
          cb(0);
        }
      }),
    } as any);
    
    await client.createChatCompletion({
      messages: [
        { role: "system", content: "You are a browser automation assistant" },
        { role: "user", content: "AX Tree: [...]\nInstruction: 点击登录按钮" },
      ],
    });
    
    expect(mockSpawn).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining([
        "-p",
        "AX Tree: [...]\nInstruction: 点击登录按钮",
        "--append-system-prompt",
        expect.stringContaining("You are a browser automation assistant"),
        "--append-system-prompt",
        expect.stringContaining("优先使用 data-testid"),
      ])
    );
  });
  
  it("应该解析 Claude Code 的 JSON 响应", async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockStdout = {
      on: vi.fn((event, cb) => {
        if (event === "data") {
          cb(JSON.stringify({
            result: "Found login button",
            structured_output: {
              elementId: "0-9",
              method: "click",
              arguments: [],
              twoStep: false,
            },
            session_id: "abc-123",
            total_cost_usd: 0.003,
            cost_usd: { "claude-3-5-sonnet": 0.003 },
          }));
        }
      }),
    };
    
    mockSpawn.mockReturnValue({
      stdout: mockStdout,
      stderr: { on: vi.fn() },
      on: vi.fn((event, cb) => {
        if (event === "close") cb(0);
      }),
    } as any);
    
    const result = await client.createChatCompletion({
      messages: [
        { role: "user", content: "点击登录按钮" },
      ],
    });
    
    expect(result.choices[0].message.content).toContain("elementId");
    expect(result.choices[0].message.content).toContain("0-9");
    expect(result.choices[0].message.content).toContain("click");
  });
  
  it("应该处理 Claude Code 执行失败", async () => {
    const mockSpawn = vi.mocked(spawn);
    const mockStderr = {
      on: vi.fn((event, cb) => {
        if (event === "data") {
          cb("Error: claude command not found");
        }
      }),
    };
    
    mockSpawn.mockReturnValue({
      stdout: { on: vi.fn() },
      stderr: mockStderr,
      on: vi.fn((event, cb) => {
        if (event === "close") cb(1);
      }),
    } as any);
    
    await expect(
      client.createChatCompletion({
        messages: [{ role: "user", content: "点击登录按钮" }],
      })
    ).rejects.toThrow("claude -p exited with code 1");
  });
});
```

---

### TC-2: ClaudeCodeLanguageModel 单元测试

**文件：** `tests/claude-code-model.test.ts`

```typescript
import { describe, it, expect, vi } from "vitest";
import { ClaudeCodeLanguageModel } from "../src/claude-code-model.js";
import { Logger } from "../src/logger.js";

describe("ClaudeCodeLanguageModel", () => {
  it("应该构建正确的 claude -p 命令", () => {
    const logger = new Logger({ target: "stdout" });
    const model = new ClaudeCodeLanguageModel({
      systemPromptEnhancement: "优先使用 data-testid",
      claudeArgs: ["--project-dir", "./e2e-skills"],
      logger,
    });
    
    const args = model.buildCommandArgs(
      "You are a browser automation assistant",
      "AX Tree: [...]\nInstruction: 点击登录按钮"
    );
    
    expect(args).toContain("-p");
    expect(args).toContain("AX Tree: [...]\nInstruction: 点击登录按钮");
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
    expect(args).toContain("--max-turns");
    expect(args).toContain("1");
    expect(args).toContain("--project-dir");
    expect(args).toContain("./e2e-skills");
  });
  
  it("应该合并 system prompt 和 enhancement", () => {
    const logger = new Logger({ target: "stdout" });
    const model = new ClaudeCodeLanguageModel({
      systemPromptEnhancement: "优先使用 data-testid",
      logger,
    });
    
    const args = model.buildCommandArgs(
      "You are a browser automation assistant",
      "点击登录按钮"
    );
    
    const systemPromptIndex = args.indexOf("--append-system-prompt");
    const systemPrompt = args[systemPromptIndex + 1];
    
    expect(systemPrompt).toContain("You are a browser automation assistant");
    expect(systemPrompt).toContain("优先使用 data-testid");
  });
});
```

---

### TC-3: Logger 单元测试

**文件：** `tests/logger.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Logger } from "../src/logger.js";
import { appendFileSync, mkdirSync } from "node:fs";

vi.mock("node:fs", () => ({
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

describe("Logger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });
  
  it("应该在 CI 环境输出到 stdout", () => {
    process.env.CI = "true";
    
    const logger = new Logger({ level: "info", target: "auto" });
    const stdoutSpy = vi.spyOn(process.stdout, "write");
    
    logger.info("Test message", { key: "value" });
    
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining("[INFO] Test message")
    );
  });
  
  it("应该在本地环境输出到文件", () => {
    const logger = new Logger({
      level: "info",
      target: "auto",
      filePath: "./.stagehand-logs/test.log",
    });
    
    logger.info("Test message", { key: "value" });
    
    expect(appendFileSync).toHaveBeenCalledWith(
      "./.stagehand-logs/test.log",
      expect.stringContaining("[INFO] Test message")
    );
  });
  
  it("应该尊重日志级别", () => {
    const logger = new Logger({ level: "warn", target: "stdout" });
    const stdoutSpy = vi.spyOn(process.stdout, "write");
    
    logger.debug("Debug message");
    logger.info("Info message");
    logger.warn("Warn message");
    logger.error("Error message");
    
    expect(stdoutSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Debug message")
    );
    expect(stdoutSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Info message")
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining("Warn message")
    );
    expect(stdoutSpy).toHaveBeenCalledWith(
      expect.stringContaining("Error message")
    );
  });
});
```

---

### TC-4: 集成测试（Mock claude -p）

**文件：** `tests/integration.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Stagehand } from "@browserbasehq/stagehand";
import { createClaudeCodeLLMClient } from "../src/llm-client.js";
import { spawn } from "node:child_process";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

describe("Integration: Stagehand + ClaudeCodeLLMClient", () => {
  let stagehand: Stagehand;
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockReturnValue({
      stdout: {
        on: vi.fn((event, cb) => {
          if (event === "data") {
            cb(JSON.stringify({
              result: "Found login button",
              structured_output: {
                elementId: "0-9",
                method: "click",
                arguments: [],
              },
              session_id: "test-session",
              total_cost_usd: 0.003,
            }));
          }
        }),
      },
      stderr: { on: vi.fn() },
      on: vi.fn((event, cb) => {
        if (event === "close") cb(0);
      }),
    } as any);
    
    stagehand = new Stagehand({
      env: "LOCAL",
      llmClient: createClaudeCodeLLMClient({
        logTarget: "stdout",
      }),
      cacheDir: "./.stagehand-cache-test",
    });
  });
  
  it("应该成功执行 act() 并缓存选择器", async () => {
    await stagehand.init();
    
    const page = stagehand.context.pages()[0];
    await page.goto("https://app.example.com/login");
    
    // 这个 act() 会调用 claude -p
    await stagehand.act("点击登录按钮");
    
    // 验证 spawn 被调用
    expect(spawn).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["-p", expect.stringContaining("点击登录按钮")])
    );
    
    await stagehand.close();
  });
});
```

---

### TC-5: E2E 测试（真实 claude -p）

**文件：** `tests/e2e.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Stagehand } from "@browserbasehq/stagehand";
import { createClaudeCodeLLMClient } from "../src/llm-client.js";
import { existsSync, rmSync } from "node:fs";

describe("E2E: Real Claude Code Integration", () => {
  let stagehand: Stagehand;
  const testCacheDir = "./.stagehand-cache-e2e";
  
  beforeAll(async () => {
    // 清理测试缓存
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true });
    }
    
    stagehand = new Stagehand({
      env: "LOCAL",
      llmClient: createClaudeCodeLLMClient({
        claudeArgs: ["--project-dir", "./e2e-skills"],
        logLevel: "info",
        logTarget: "stdout",
      }),
      cacheDir: testCacheDir,
    });
    
    await stagehand.init();
  });
  
  afterAll(async () => {
    await stagehand.close();
  });
  
  it("应该使用 Claude Code 生成选择器", async () => {
    const page = stagehand.context.pages()[0];
    await page.goto("https://the-internet.herokuapp.com/login");
    
    // 这个 act() 会调用真实的 claude -p
    await stagehand.act("输入用户名 tomsmith");
    
    // 验证缓存文件已创建
    const cacheFiles = require("fs").readdirSync(testCacheDir);
    expect(cacheFiles.length).toBeGreaterThan(0);
  }, 30000); // 30秒超时（Claude Code 调用可能较慢）
  
  it("应该在第二次运行时命中缓存", async () => {
    const page = stagehand.context.pages()[0];
    await page.goto("https://the-internet.herokuapp.com/login");
    
    const startTime = Date.now();
    
    // 这个 act() 应该命中缓存
    await stagehand.act("输入用户名 tomsmith");
    
    const duration = Date.now() - startTime;
    
    // 缓存命中应该很快（< 100ms）
    expect(duration).toBeLessThan(100);
  });
});
```

---

## 4. 验收标准汇总

### 功能验收

- [ ] US-1: 语义化测试编写
  - [ ] 测试代码中只出现 `act("...")` 指令
  - [ ] 不出现选择器代码
  
- [ ] US-2: 首次运行生成选择器
  - [ ] 首次运行调用 `claude -p`
  - [ ] 生成的选择器使用高泛化性策略
  - [ ] 选择器写入缓存文件
  
- [ ] US-3: CI 运行零 LLM 成本
  - [ ] 全部命中缓存
  - [ ] 不调用 `claude -p`
  - [ ] 日志输出到 stdout
  
- [ ] US-4: 自愈 + Git Commit
  - [ ] 选择器失效时自动修复
  - [ ] 生成 git commit
  - [ ] Commit 包含新旧选择器对比
  
- [ ] US-5: E2E 测试报告
  - [ ] 报告包含测试状态
  - [ ] 报告包含缓存命中率
  - [ ] 报告包含自愈事件

### 测试验收

- [ ] TC-1: ClaudeCodeLLMClient 单元测试（3 个测试用例）
- [ ] TC-2: ClaudeCodeLanguageModel 单元测试（2 个测试用例）
- [ ] TC-3: Logger 单元测试（3 个测试用例）
- [ ] TC-4: 集成测试（1 个测试用例）
- [ ] TC-5: E2E 测试（2 个测试用例）

### Demo 验收

- [ ] Demo-1: 基础 E2E 测试（登录流程）
- [ ] Demo-2: 自愈场景
- [ ] Demo-3: CI Workflow
- [ ] Demo-4: 缓存预热脚本

---

**文档结束**
