# RFC: Playwright 测试框架集成 — Stagehand 管理浏览器 + Playwright 管理页面

**状态：** 已批准  
**作者：** AI Assistant  
**创建日期：** 2026-06-25  
**修订日期：** 2026-06-26  
**基于：** [claude-code-llm-client RFC](../claude-code-llm-client/rfc.md)（已批准）

---

## 1. 概述

本 RFC 提出将 E2E 测试运行框架从 **Vitest** 迁移到 **`@playwright/test`**，采用 **Stagehand 创建浏览器实例 + Playwright 通过 CDP 连接并管理页面** 的架构，保留 Stagehand 的缓存回放能力（零 LLM 消耗），并输出 Playwright 原生测试报告。

**核心架构：**

```
Stagehand: new Stagehand({ env: "LOCAL" }) → init() → 启动 Chrome
    ↓
stagehand.connectURL() → "ws://127.0.0.1:PORT/devtools/browser/..."
    ↓
Playwright: chromium.connectOverCDP(cdpUrl) → 连接同一浏览器
    ↓
Playwright 管理页面生命周期：导航、断言、截图、trace
Stagehand 语义操作：act() / extract() 接收 Playwright page 参数
    ↓
Playwright Reporter: HTML / JSON 报告 + Trace + Screenshot
```

**关键设计原则：**

1. **Stagehand 创建浏览器** — Stagehand 自行启动 Chrome，通过 `connectURL()` 暴露 CDP WebSocket URL
2. **Playwright 连接 CDP** — Playwright 通过 `connectOverCDP()` 连接 Stagehand 的浏览器
3. **Playwright 管理页面** — 页面的创建、导航、断言等生命周期由 Playwright 管理
4. **Stagehand 接收 page 参数** — `act()`/`extract()` 通过 `{ page }` 选项接收 Playwright Page，Stagehand 内部通过 CDP frame ID 桥接到自己的 V3 Page
5. **缓存回放不变** — Stagehand 的 `cacheDir` 机制完整保留，第二次运行零 LLM 消耗

## 2. 问题陈述

### 2.1 当前 Vitest 方案的局限

| 问题 | 描述 | 影响 |
|------|------|------|
| **无原生浏览器管理** | Vitest 不提供浏览器生命周期管理 | 每个测试文件各自管理浏览器 |
| **报告能力有限** | Vitest 缺少 HTML 报告、trace viewer | 调试分析困难 |
| **非 E2E 标准** | Vitest 主要用于单元测试 | 团队学习成本高 |
| **缺少 trace/replay** | 无操作录制、截图、视频 | 失败排查效率低 |

### 2.2 之前方案的失败分析

**方案 A（Playwright launchServer + Stagehand cdpUrl）失败原因：**

1. Playwright 的 `launchServer()` 创建 Playwright 管理的 BrowserServer
2. Stagehand 通过 `cdpUrl` 连接后创建独立的 V3Context
3. 两个系统各自创建独立的 BrowserContext 和 target 映射
4. Stagehand 的 `resolvePageByMainFrameId()` 无法识别 Playwright 创建的页面 target
5. 根本原因：**浏览器应由 Stagehand 创建**，Playwright 作为 CDP 客户端连接

## 3. 方案选择与决策

### 3.1 选定方案：Stagehand 创建浏览器 + Playwright 连接 CDP + Playwright 管理页面

**思路：** 参考 Stagehand 官方 Playwright 集成文档（docs.stagehand.dev/v3/integrations/playwright），Stagehand 自行启动 Chrome，通过公开的 `connectURL()` API 暴露 CDP WebSocket URL。Playwright 通过 `connectOverCDP()` 连接同一浏览器，并管理页面生命周期。

**Stagehand 关键 API：**

```typescript
// Stagehand V3 公开方法
class Stagehand {
  init(): Promise<void>;
  connectURL(): string;  // init() 后返回 CDP WebSocket URL
  act(instruction: string, options?: ActOptions): Promise<ActResult>;
  extract<T>(instruction: string, schema: T, options?: ExtractOptions): Promise<...>;
}

// act/extract/observe 都接受 Playwright Page
interface ActOptions {
  page?: PlaywrightPage | PuppeteerPage | PatchrightPage | Page;
  // ...
}
interface ExtractOptions {
  page?: PlaywrightPage | PuppeteerPage | PatchrightPage | Page;
  // ...
}
```

**页面共享机制（Stagehand 内部实现）：**

当 Playwright Page 传给 `act()`/`extract()` 时，Stagehand 内部：
1. 通过 `isPlaywrightPage()` 检测（检查 `typeof p.context === "function"`）
2. 创建 CDP session：`await page.context().newCDPSession(page)`
3. 获取 frame tree：`await cdp.send("Page.getFrameTree")`
4. 提取 top frame ID：`frameTree.frame.id`
5. 通过 `ctx.resolvePageByMainFrameId(frameId)` 桥接到 Stagehand 内部 V3 Page

**这意味着 Playwright 和 Stagehand 操作的是同一个页面**，只是各自有不同的抽象层。

### 3.2 其他方案（放弃）

| 方案 | 放弃理由 |
|------|---------|
| **Playwright launchServer + Stagehand cdpUrl** | 浏览器由 Playwright 创建，Stagehand 无法识别 Playwright 的页面 target |
| **chrome-launcher 独立启动** | 增加额外进程管理，且 Stagehand 通过 cdpUrl 连接仍有 target 映射问题 |
| **Playwright Fixture 封装** | 无法从 Playwright browser 提取 CDP URL 传给 Stagehand |

## 4. 架构设计

### 4.1 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│  playwright.config.ts                                       │
│                                                             │
│  // 不使用 globalSetup/globalTeardown                       │
│  // Stagehand 在测试的 beforeAll/afterAll 中管理浏览器        │
│  reporter: [["list"], ["html"], ["json"]]                   │
│  use: { cdpUrl: 从 .cdp-url.tmp 文件读取 }                   │
│  trace: "on-first-retry"                                    │
│  screenshot: "only-on-failure"                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  mdn-blog.spec.ts (测试文件)                                │
│                                                             │
│  let stagehand: Stagehand;                                  │
│  let browser: Browser;                                      │
│                                                             │
│  test.beforeAll(async () => {                               │
│    // 1. Stagehand 创建浏览器                                │
│    stagehand = new Stagehand({                              │
│      env: "LOCAL",                                          │
│      llmClient: createClaudeCodeLLMClient({...}),           │
│      cacheDir: ".stagehand-cache",                          │
│    });                                                      │
│    await stagehand.init();                                  │
│                                                             │
│    // 2. 获取 CDP WebSocket URL                             │
│    const cdpUrl = stagehand.connectURL();                   │
│    writeFileSync('.cdp-url.tmp', cdpUrl);                   │
│  });                                                        │
│                                                             │
│  test("点击 Read more", async ({ browser }) => {            │
│    // Playwright 管理页面                                    │
│    const page = await browser.newPage();                    │
│                                                             │
│    await page.goto(BLOG_URL);              // Playwright 导航│
│    await stagehand.act("点击...", { page }); // Stagehand 操作│
│    await expect(page).toHaveURL(...);      // Playwright 断言│
│  });                                                        │
│                                                             │
│  test.afterAll(async () => {                                │
│    await stagehand.close();  // 关闭 Chrome                 │
│  });                                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Stagehand `connectURL()` — 公开 API

```typescript
// Stagehand V3 公开方法，init() 后可用
const stagehand = new Stagehand({ env: "LOCAL" });
await stagehand.init();

const cdpUrl = stagehand.connectURL();
// → "ws://127.0.0.1:PORT/devtools/browser/BROWSER_ID"

// Playwright 连接
const browser = await chromium.connectOverCDP(cdpUrl);
```

**这是 Stagehand 的公开 API**，不需要访问内部实现，无版本兼容风险。

### 4.3 页面管理由 Playwright 负责

```typescript
test("测试用例", async ({ browser }) => {
  // Playwright 创建页面
  const page = await browser.newPage();

  // Playwright 导航
  await page.goto(BLOG_URL);

  // Stagehand 语义操作 — 传入 Playwright page
  // Stagehand 内部通过 CDP frame ID 桥接到自己的 V3 Page
  await stagehand.act("点击第一个博客卡片的 Read more 按钮", { page });

  // Playwright 等待和断言
  await page.waitForLoadState("domcontentloaded");
  await expect(page).toHaveURL(/\/blog\/.+/);

  // Stagehand 语义提取 — 传入 Playwright page
  const content = await stagehand.extract("提取文章内容", schema, { page });

  // Playwright 清理
  await page.close();
});
```

### 4.4 Trace / Screenshot 集成

```typescript
// playwright.config.ts
export default defineConfig({
  retries: 1,
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
});
```

**与 CDP 连接的兼容性：**
- Playwright 通过 `connectOverCDP()` 连接后，trace/screenshot 功能正常可用
- 因为 Playwright 管理 BrowserContext 和 Page，可以正常调用 `tracing.start()` 和 `screenshot()`
- 如果 `use.trace` 在 CDP 模式下有异常，回退到手动 `page.context().tracing.start()`

### 4.5 缓存回放工作流

缓存机制完整保留，工作流不变：

```
首次运行:
  act("点击 Read more", { page })
    → ActCache.tryReplay() → 缓存未命中
    → actInference() → ClaudeCodeLLMClient → claude -p
    → 生成选择器 → ActCache.store() → .stagehand-cache/<hash>.json
    → 执行成功 ✅
  → 提交缓存: git add .stagehand-cache/ && git commit

第二次运行:
  act("点击 Read more", { page })
    → ActCache.tryReplay() → 缓存命中 ✅
    → replayCachedActions() → 确定性执行（无 LLM 调用）
    → 0 次 claude -p 调用 → 毫秒级执行
```

## 5. 影响范围

### 5.1 需要变更的文件

| 文件 | 变更类型 | 描述 |
|------|----------|------|
| `examples/mdn-blog/mdn-blog.spec.ts` | **重写** | Vitest → Playwright test 格式，使用 `connectURL()` + `{ page }` |
| `examples/mdn-blog/playwright.config.ts` | **新增** | Playwright 配置文件（reporter、trace、screenshot） |
| `examples/mdn-blog/package.json` | **修改** | 添加 `@playwright/test` 依赖，更新 scripts |
| `examples/mdn-blog/vitest.config.ts` | **删除** | 不再使用 Vitest |
| `.gitignore` | **修改** | 添加 `.cdp-url.tmp`、`test-results/`、`playwright-report/` 忽略 |

### 5.2 不需要变更的文件

| 文件/模块 | 原因 |
|-----------|------|
| `src/llm-client.ts` | 核心 LLM 客户端不变 |
| `src/claude-code-model.ts` | Claude Code 调用不变 |
| `src/self-heal.ts` | 自愈机制不变 |
| `src/report.ts` | 报告模块不变 |
| `src/types.ts` | 类型定义不变 |
| `src/index.ts` | 公共 API 不变 |
| `tests/*.test.ts` | 单元测试仍使用 Vitest |
| `e2e-skills/CLAUDE.md` | Skill 文档不变 |

**关键：核心库 `src/` 零改动。** `connectURL()` 是 Stagehand 的公开 API，不需要辅助函数。

## 6. 风险与缓解

### 6.1 CDP URL 传递时序

**风险：** `connectURL()` 只在 `init()` 之后可用，而 Playwright config 的 `use.cdpUrl` 在 config 加载时就需要值。

**缓解：**
- 在 `beforeAll` 中调用 `init()` 后获取 `connectURL()`
- 写入 `.cdp-url.tmp` 文件
- Playwright config 中使用 `readFileSync` 读取（config 在 worker 进程加载时可读文件）
- 或使用 `process.env.STAGEHAND_CDP_URL` 环境变量（需通过 Playwright 的 `--workers=1` 确保同进程）

### 6.2 Stagehand close() 与 Playwright 连接

**风险：** `stagehand.close()` 关闭 Chrome 后 Playwright 连接断开。

**缓解：**
- `afterAll` 中调用 `stagehand.close()`，确保所有测试已完成
- 不在 `afterEach` 中关闭 Stagehand

### 6.3 页面 target 桥接

**风险：** Stagehand 通过 CDP frame ID 桥接 Playwright page 时可能失败。

**缓解：**
- 使用 `stagehand.act(instruction, { page })` 显式传参，确保 Stagehand 操作正确的页面
- Stagehand 的 `resolvePageByMainFrameId()` 会自动匹配 CDP frame ID 到 V3 Page
- 如果匹配失败，Stagehand 会抛出明确的错误信息

### 6.4 Trace/Screenshot 在 CDP 模式下的兼容性

**风险：** Playwright 的 `use.trace` 在 `connectOverCDP` 模式下可能不完全生效。

**缓解：**
- 优先使用配置项
- 回退到手动 `page.context().tracing.start()` 和 `page.screenshot()`
- 在实现阶段验证实际行为

## 7. 开放问题

### 7.1 是否需要 globalSetup/globalTeardown？

**当前方案：** 不使用。Stagehand 在测试的 `beforeAll`/`afterAll` 中管理。

**理由：** Stagehand 实例需要在 worker 进程中运行（不能在 globalSetup 中启动后传递实例到 worker）。

### 7.2 Playwright workers 配置

**当前方案：** `workers: 1`（串行）。

**理由：** 每个 worker 会启动独立的 Stagehand 实例和 Chrome 进程，串行避免端口冲突。

### 7.3 Playwright 的 cdpUrl 配置传递

**Q：** 如何在 Playwright config 中动态设置 `cdpUrl`？

**当前方案：** 在 `beforeAll` 中写入 `.cdp-url.tmp` 文件，Playwright config 通过 `readFileSync` 读取。由于 `workers: 1`，config 在 worker 启动时加载，此时 `beforeAll` 已执行过（globalSetup 阶段）。

**备选：** 不使用 `use.cdpUrl`，在测试代码中手动 `chromium.connectOverCDP()` 并创建 fixture。

---

**建议：** 批准本 RFC，继续进入 SPEC（技术规格）阶段。
