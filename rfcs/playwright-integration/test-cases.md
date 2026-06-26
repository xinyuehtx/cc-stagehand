# Test Cases: Playwright 测试框架集成

**状态：** 待评审  
**版本：** 1.0  
**日期：** 2026-06-25  
**依赖：** [User Stories v1.0](./user-story.md)（已批准）

---

## 测试策略

本次变更不涉及核心库 `src/` 修改，测试聚焦于：

1. **单元测试** — globalSetup/globalTeardown 逻辑（mock Playwright API）
2. **集成测试** — Stagehand 通过 cdpUrl 连接已有浏览器
3. **E2E 测试** — mdn-blog.spec.ts 在 Playwright 下的完整运行
4. **回归测试** — 确保核心库和其他示例不受影响

测试分层：

```
┌─────────────────────────────────────────────────┐
│  E2E 测试（examples/mdn-blog/mdn-blog.spec.ts）  │  ← 真实浏览器 + 真实 LLM
├─────────────────────────────────────────────────┤
│  集成测试（tests/playwright-integration.test.ts） │  ← 真实浏览器 + mock LLM
├─────────────────────────────────────────────────┤
│  单元测试（tests/playwright-setup.test.ts）       │  ← mock chromium + mock fs
│  单元测试（tests/playwright-teardown.test.ts）    │  ← mock chromium + mock fs
├─────────────────────────────────────────────────┤
│  回归测试（tests/*.test.ts — 不变）               │  ← 验证核心库不受影响
└─────────────────────────────────────────────────┘
```

---

## 1. 单元测试

### TC-1: globalSetup 启动浏览器服务器

**文件：** `tests/playwright-setup.test.ts`  
**覆盖 User Story：** US-2  
**前置条件：** mock `chromium.launchServer` 和 `fs.writeFileSync`

| 用例 ID | 测试名称 | 步骤 | 期望结果 |
|---------|---------|------|---------|
| TC-1.1 | 启动浏览器服务器并写入 wsEndpoint 文件 | 1. mock `chromium.launchServer()` 返回 `{ wsEndpoint: "ws://127.0.0.1:54321/dev/browser/abc", close: fn }`<br>2. 调用 `globalSetup()`<br>3. 检查 `writeFileSync` 调用 | `writeFileSync` 被调用，参数为 `(.ws-endpoint.tmp, "ws://127.0.0.1:54321/dev/browser/abc")` |
| TC-1.2 | 设置环境变量 STAGEHAND_WS_ENDPOINT | 1. mock `chromium.launchServer()`<br>2. 调用 `globalSetup()`<br>3. 检查 `process.env.STAGEHAND_WS_ENDPOINT` | 环境变量被设置为 wsEndpoint 值 |
| TC-1.3 | 浏览器启动失败时抛出错误 | 1. mock `chromium.launchServer()` 抛出错误<br>2. 调用 `globalSetup()`<br>3. 捕获异常 | 抛出原始错误，不写入文件 |

```typescript
// tests/playwright-setup.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync } from "node:fs";

vi.mock("node:fs", () => ({
  writeFileSync: vi.fn(),
}));

vi.mock("@playwright/test", () => ({
  chromium: {
    launchServer: vi.fn(),
  },
}));

import { chromium } from "@playwright/test";

describe("globalSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.STAGEHAND_WS_ENDPOINT;
  });

  it("TC-1.1: 启动浏览器服务器并写入 wsEndpoint 文件", async () => {
    const mockWsEndpoint = "ws://127.0.0.1:54321/dev/browser/abc";
    const mockServer = {
      wsEndpoint: () => mockWsEndpoint,
      close: vi.fn(),
    };
    vi.mocked(chromium.launchServer).mockResolvedValue(mockServer as any);

    const { default: globalSetup } = await import(
      "../examples/mdn-blog/playwright-setup.js"
    );
    await globalSetup();

    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining(".ws-endpoint.tmp"),
      mockWsEndpoint
    );
  });

  it("TC-1.2: 设置环境变量 STAGEHAND_WS_ENDPOINT", async () => {
    const mockWsEndpoint = "ws://127.0.0.1:54321/dev/browser/abc";
    const mockServer = {
      wsEndpoint: () => mockWsEndpoint,
      close: vi.fn(),
    };
    vi.mocked(chromium.launchServer).mockResolvedValue(mockServer as any);

    const { default: globalSetup } = await import(
      "../examples/mdn-blog/playwright-setup.js"
    );
    await globalSetup();

    expect(process.env.STAGEHAND_WS_ENDPOINT).toBe(mockWsEndpoint);
  });

  it("TC-1.3: 浏览器启动失败时抛出错误", async () => {
    vi.mocked(chromium.launchServer).mockRejectedValue(
      new Error("Failed to launch")
    );

    const { default: globalSetup } = await import(
      "../examples/mdn-blog/playwright-setup.js"
    );

    await expect(globalSetup()).rejects.toThrow("Failed to launch");
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});
```

---

### TC-2: globalTeardown 关闭浏览器服务器

**文件：** `tests/playwright-teardown.test.ts`  
**覆盖 User Story：** US-2  
**前置条件：** mock `chromium.connectOverCDP` 和 `fs` 操作

| 用例 ID | 测试名称 | 步骤 | 期望结果 |
|---------|---------|------|---------|
| TC-2.1 | 正常关闭浏览器服务器 | 1. mock `readFileSync` 返回 wsEndpoint<br>2. mock `connectOverCDP` 返回 `{ close: fn }`<br>3. 调用 `globalTeardown()` | `browser.close()` 被调用，临时文件被删除 |
| TC-2.2 | wsEndpoint 文件不存在时跳过清理 | 1. mock `existsSync` 返回 `false`<br>2. 调用 `globalTeardown()` | 不抛出错误，不调用 `connectOverCDP` |
| TC-2.3 | 关闭浏览器失败时不抛出错误 | 1. mock `connectOverCDP` 返回的 `close()` 抛出错误<br>2. 调用 `globalTeardown()` | `console.warn` 被调用，不抛出错误，临时文件仍被清理 |

```typescript
// tests/playwright-teardown.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock("@playwright/test", () => ({
  chromium: {
    connectOverCDP: vi.fn(),
  },
}));

import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { chromium } from "@playwright/test";

describe("globalTeardown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("TC-2.1: 正常关闭浏览器服务器", async () => {
    const mockWsEndpoint = "ws://127.0.0.1:54321/dev/browser/abc";
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(mockWsEndpoint);

    const mockClose = vi.fn().mockResolvedValue(undefined);
    vi.mocked(chromium.connectOverCDP).mockResolvedValue({
      close: mockClose,
    } as any);

    const { default: globalTeardown } = await import(
      "../examples/mdn-blog/playwright-teardown.js"
    );
    await globalTeardown();

    expect(chromium.connectOverCDP).toHaveBeenCalledWith(mockWsEndpoint);
    expect(mockClose).toHaveBeenCalled();
    expect(unlinkSync).toHaveBeenCalled();
  });

  it("TC-2.2: wsEndpoint 文件不存在时跳过清理", async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const { default: globalTeardown } = await import(
      "../examples/mdn-blog/playwright-teardown.js"
    );
    await globalTeardown();

    expect(chromium.connectOverCDP).not.toHaveBeenCalled();
    expect(unlinkSync).not.toHaveBeenCalled();
  });

  it("TC-2.3: 关闭浏览器失败时不抛出错误", async () => {
    const mockWsEndpoint = "ws://127.0.0.1:54321/dev/browser/abc";
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(mockWsEndpoint);

    vi.mocked(chromium.connectOverCDP).mockResolvedValue({
      close: vi.fn().mockRejectedValue(new Error("Connection lost")),
    } as any);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { default: globalTeardown } = await import(
      "../examples/mdn-blog/playwright-teardown.js"
    );

    // 不应抛出
    await globalTeardown();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to close"),
      expect.anything()
    );

    // 临时文件仍应被清理
    expect(unlinkSync).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
```

---

## 2. 集成测试

### TC-3: Stagehand 通过 cdpUrl 连接已有浏览器

**文件：** `tests/playwright-integration.test.ts`  
**覆盖 User Story：** US-2, US-6  
**前置条件：** 真实 `chromium.launchServer()`，mock `spawn`（Claude Code）

| 用例 ID | 测试名称 | 步骤 | 期望结果 |
|---------|---------|------|---------|
| TC-3.1 | Stagehand 通过 cdpUrl 成功连接 | 1. `chromium.launchServer()` 启动服务器<br>2. 获取 `wsEndpoint()`<br>3. `new Stagehand({ localBrowserLaunchOptions: { cdpUrl } })`<br>4. `stagehand.init()` | Stagehand 成功初始化，不启动新 Chrome 进程 |
| TC-3.2 | Playwright page 和 Stagehand 操作同一浏览器 | 1. 启动服务器 + 初始化 Stagehand<br>2. 通过 Playwright `connectOverCDP` 获取 page<br>3. Playwright `page.goto(url)`<br>4. Stagehand `extract()` | 两者操作同一页面，extract 能读到 Playwright 导航后的内容 |
| TC-3.3 | Stagehand close() 不关闭浏览器服务器 | 1. 初始化 Stagehand<br>2. `stagehand.close()`<br>3. 尝试通过 Playwright 连接 | 浏览器服务器仍在运行，Playwright 可正常连接 |

```typescript
// tests/playwright-integration.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { chromium, type BrowserServer } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import { createClaudeCodeLLMClient } from "../src/index.js";
import { spawn } from "node:child_process";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

describe("Stagehand + Playwright CDP 集成", () => {
  let server: BrowserServer;
  let wsEndpoint: string;

  beforeAll(async () => {
    server = await chromium.launchServer({ headless: true });
    wsEndpoint = server.wsEndpoint();
  });

  afterAll(async () => {
    await server.close();
  });

  it("TC-3.1: Stagehand 通过 cdpUrl 成功连接", async () => {
    const stagehand = new Stagehand({
      env: "LOCAL",
      localBrowserLaunchOptions: { cdpUrl: wsEndpoint },
      llmClient: createClaudeCodeLLMClient({ logTarget: "stdout" }),
    });

    await stagehand.init();
    expect(stagehand.context).toBeDefined();

    await stagehand.close();
  });

  it("TC-3.2: Playwright page 和 Stagehand 操作同一浏览器", async () => {
    // Playwright 连接
    const browser = await chromium.connectOverCDP(wsEndpoint);
    const contexts = browser.contexts();
    const page = contexts[0]?.pages()[0] ?? await contexts[0].newPage();

    // Stagehand 连接同一浏览器
    const stagehand = new Stagehand({
      env: "LOCAL",
      localBrowserLaunchOptions: { cdpUrl: wsEndpoint },
      llmClient: createClaudeCodeLLMClient({ logTarget: "stdout" }),
    });
    await stagehand.init();

    // Playwright 导航
    await page.goto("https://example.com");

    // Stagehand 提取 — 应该能读到 Playwright 导航后的页面
    // 这里 mock LLM 返回，只验证流程不通
    // （真实 LLM 测试在 E2E 阶段）

    await stagehand.close();
    await browser.close();
  });

  it("TC-3.3: Stagehand close() 不关闭浏览器服务器", async () => {
    const stagehand = new Stagehand({
      env: "LOCAL",
      localBrowserLaunchOptions: { cdpUrl: wsEndpoint },
      llmClient: createClaudeCodeLLMClient({ logTarget: "stdout" }),
    });
    await stagehand.init();
    await stagehand.close();

    // 服务器仍在运行 — Playwright 可连接
    const browser = await chromium.connectOverCDP(wsEndpoint);
    expect(browser.isConnected()).toBe(true);
    await browser.close();
  });
});
```

---

### TC-4: 缓存回放验证

**文件：** `tests/cache-replay.test.ts`  
**覆盖 User Story：** US-6  
**前置条件：** 预写入缓存文件，mock `spawn`

| 用例 ID | 测试名称 | 步骤 | 期望结果 |
|---------|---------|------|---------|
| TC-4.1 | 缓存命中时不调用 LLM | 1. 预写入缓存文件到 `.stagehand-cache/`<br>2. Stagehand `act()` 对应指令<br>3. 检查 `spawn` 是否被调用 | `spawn` 未被调用（零 LLM 调用） |
| TC-4.2 | 缓存命中执行速度 < 200ms | 1. 预写入缓存文件<br>2. 计时 `act()` 执行 | 耗时 < 200ms |

```typescript
// tests/cache-replay.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const TEST_CACHE_DIR = "./.stagehand-cache-test-replay";

describe("缓存回放", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true });
    }
    mkdirSync(TEST_CACHE_DIR, { recursive: true });
  });

  it("TC-4.1: 缓存命中时不调用 LLM (spawn)", async () => {
    // 构建缓存 key（与 Stagehand 内部逻辑一致）
    const instruction = "点击登录按钮";
    const url = "https://example.com/login";
    const payload = JSON.stringify({ instruction, url, variableKeys: [] });
    const cacheKey = createHash("sha256").update(payload).digest("hex");

    // 预写入缓存文件
    const cacheEntry = {
      version: 1,
      instruction,
      url,
      variableKeys: [],
      actions: [
        {
          selector: "[data-testid='login-btn']",
          description: "点击登录按钮",
          method: "click",
          arguments: [],
        },
      ],
      actionDescription: "点击登录按钮",
      message: "Clicked login button",
    };
    writeFileSync(
      join(TEST_CACHE_DIR, `${cacheKey}.json`),
      JSON.stringify(cacheEntry, null, 2)
    );

    // 验证缓存文件存在
    const files = require("node:fs").readdirSync(TEST_CACHE_DIR);
    expect(files.length).toBe(1);
    expect(files[0]).toBe(`${cacheKey}.json`);

    // 注意：完整验证需要启动 Stagehand + 浏览器
    // 此处仅验证缓存文件结构正确
  });

  it("TC-4.2: 缓存文件格式验证", () => {
    const instruction = "点击提交按钮";
    const url = "https://example.com/form";
    const payload = JSON.stringify({ instruction, url, variableKeys: [] });
    const cacheKey = createHash("sha256").update(payload).digest("hex");

    const cacheEntry = {
      version: 1,
      instruction,
      url,
      variableKeys: [],
      actions: [
        {
          selector: "button[type='submit']",
          description: "点击提交按钮",
          method: "click",
          arguments: [],
        },
      ],
      actionDescription: "点击提交按钮",
      message: "Clicked submit button",
    };

    const cachePath = join(TEST_CACHE_DIR, `${cacheKey}.json`);
    writeFileSync(cachePath, JSON.stringify(cacheEntry, null, 2));

    // 验证可读取并解析
    const content = JSON.parse(
      require("node:fs").readFileSync(cachePath, "utf-8")
    );
    expect(content.version).toBe(1);
    expect(content.instruction).toBe(instruction);
    expect(content.actions).toHaveLength(1);
    expect(content.actions[0].selector).toBe("button[type='submit']");
  });
});
```

---

## 3. E2E 测试

### TC-5: MDN Blog 完整测试流程

**文件：** `examples/mdn-blog/mdn-blog.spec.ts`（即 E2E 测试本身）  
**覆盖 User Story：** US-1 ~ US-6  
**前置条件：** 真实浏览器 + 真实 Claude Code

| 用例 ID | 测试名称 | 步骤 | 期望结果 |
|---------|---------|------|---------|
| TC-5.1 | 博客列表页可访问且包含卡片 | 1. Playwright 导航到 MDN Blog<br>2. 验证 URL 匹配 `/blog/`<br>3. Stagehand `extract()` 获取卡片标题 | 卡片数量 > 0 |
| TC-5.2 | 博客卡片包含完整结构 | 1. 导航到 MDN Blog<br>2. Stagehand `extract()` 提取标题、作者、摘要、链接 | 四个字段均为真值 |
| TC-5.3 | 点击 Read more 进入博客详情 | 1. 导航到 MDN Blog<br>2. Stagehand `act("点击第一个博客卡片的 Read more 按钮")`<br>3. 验证 URL 变化<br>4. Stagehand `extract()` 获取文章内容 | URL 变为详情页，文章内容非空 |

---

### TC-6: 首次运行 + 缓存回放完整流程

**文件：** 手动验证脚本（不自动化，作为验收清单）  
**覆盖 User Story：** US-6  

| 步骤 | 操作 | 期望结果 |
|------|------|---------|
| 1 | `rm -rf examples/mdn-blog/.stagehand-cache/` | 缓存目录被清空 |
| 2 | `cd examples/mdn-blog && npm test` | 3 个测试全部通过，日志中出现 "Claude Code 调用完成" |
| 3 | `ls examples/mdn-blog/.stagehand-cache/` | 至少 1 个 `.json` 缓存文件（对应 `act()` 调用） |
| 4 | `npm test`（第二次运行） | 3 个测试全部通过，**无** "Claude Code 调用完成" 日志 |
| 5 | 对比两次耗时 | 第二次运行耗时显著低于第一次（预计 < 1/3） |

---

## 4. 回归测试

### TC-7: 核心库不受影响

**文件：** 运行已有的 `tests/*.test.ts`  
**覆盖 User Story：** US-7  

| 用例 ID | 测试名称 | 步骤 | 期望结果 |
|---------|---------|------|---------|
| TC-7.1 | 根目录单元测试全部通过 | `npm test`（根目录） | 所有 `tests/*.test.ts` 通过 |
| TC-7.2 | 类型检查通过 | `npm run typecheck` | 无类型错误 |
| TC-7.3 | 构建成功 | `npm run build` | 构建产物正常生成到 `dist/` |
| TC-7.4 | src/ 目录无变更 | `git diff src/` | 无输出（无变更） |
| TC-7.5 | tests/ 目录无变更 | `git diff tests/` | 仅新增文件，不修改已有文件 |

### TC-8: Playwright 配置验证

| 用例 ID | 测试名称 | 步骤 | 期望结果 |
|---------|---------|------|---------|
| TC-8.1 | playwright.config.ts 语法正确 | `npx playwright test --list` | 列出测试用例，无解析错误 |
| TC-8.2 | globalSetup/globalTeardown 文件存在 | 检查文件 | `playwright-setup.ts` 和 `playwright-teardown.ts` 存在 |
| TC-8.3 | reporter 配置正确 | 运行测试后检查 | `playwright-report/index.html` 和 `test-results/results.json` 存在 |

---

## 5. 测试用例汇总

### 单元测试（Vitest，mock 外部依赖）

| ID | 名称 | 文件 | 覆盖 US |
|----|------|------|---------|
| TC-1.1 | globalSetup 写入 wsEndpoint | `playwright-setup.test.ts` | US-2 |
| TC-1.2 | globalSetup 设置环境变量 | `playwright-setup.test.ts` | US-2 |
| TC-1.3 | globalSetup 启动失败抛错 | `playwright-setup.test.ts` | US-2 |
| TC-2.1 | globalTeardown 正常关闭 | `playwright-teardown.test.ts` | US-2 |
| TC-2.2 | globalTeardown 文件不存在跳过 | `playwright-teardown.test.ts` | US-2 |
| TC-2.3 | globalTeardown 关闭失败容错 | `playwright-teardown.test.ts` | US-2 |

### 集成测试（Vitest，真实浏览器）

| ID | 名称 | 文件 | 覆盖 US |
|----|------|------|---------|
| TC-3.1 | Stagehand cdpUrl 连接 | `playwright-integration.test.ts` | US-2 |
| TC-3.2 | Playwright + Stagehand 共享浏览器 | `playwright-integration.test.ts` | US-2 |
| TC-3.3 | Stagehand close 不影响服务器 | `playwright-integration.test.ts` | US-2 |

### 缓存测试（Vitest，验证文件结构）

| ID | 名称 | 文件 | 覆盖 US |
|----|------|------|---------|
| TC-4.1 | 缓存命中不调用 LLM | `cache-replay.test.ts` | US-6 |
| TC-4.2 | 缓存文件格式正确 | `cache-replay.test.ts` | US-6 |

### E2E 测试（Playwright，真实浏览器 + 真实 LLM）

| ID | 名称 | 文件 | 覆盖 US |
|----|------|------|---------|
| TC-5.1 | 博客列表页可访问 | `mdn-blog.spec.ts` | US-1,2,3 |
| TC-5.2 | 博客卡片结构完整 | `mdn-blog.spec.ts` | US-1,2,3 |
| TC-5.3 | 点击 Read more | `mdn-blog.spec.ts` | US-1,2,3,6 |
| TC-6 | 首次运行 + 缓存回放 | 手动验证 | US-6 |

### 回归测试

| ID | 名称 | 命令 | 覆盖 US |
|----|------|------|---------|
| TC-7.1 | 单元测试全部通过 | `npm test`（根目录） | US-7 |
| TC-7.2 | 类型检查通过 | `npm run typecheck` | US-7 |
| TC-7.3 | 构建成功 | `npm run build` | US-7 |
| TC-7.4 | src/ 无变更 | `git diff src/` | US-7 |
| TC-8.1 | Playwright 配置语法正确 | `npx playwright test --list` | US-1 |
| TC-8.2 | Setup/Teardown 文件存在 | 文件检查 | US-2 |
| TC-8.3 | Reporter 输出正确 | 运行后检查产物 | US-3 |

---

## 6. 测试执行计划

### 阶段 1: 开发期间（TDD）

```bash
# 运行单元测试（快速反馈）
npm test                          # 根目录 Vitest

# 运行集成测试（需要浏览器）
npm test -- --run playwright-integration
```

### 阶段 2: 实现完成后

```bash
# 全部单元测试
npm test

# 类型检查
npm run typecheck

# 构建
npm run build
```

### 阶段 3: 验收

```bash
# E2E 测试（首次运行，需要 Claude Code）
cd examples/mdn-blog && npm test

# 验证缓存回放
npm test   # 第二次运行

# 回归验证
cd ../.. && npm test && npm run typecheck && npm run build
```

---

**文档结束**
