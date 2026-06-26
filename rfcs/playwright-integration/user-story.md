# User Stories: Playwright 测试框架集成

**状态：** 已批准  
**版本：** 1.0  
**日期：** 2026-06-26  
**依赖：** [SPEC v1.0](./spec.md)（已批准）

---

## 1. User Stories

### US-1: 使用 Playwright 运行 E2E 测试

**作为** 开发者  
**我希望** 使用 `@playwright/test` 作为测试运行器  
**以便** 获得 Playwright 的原生 E2E 测试体验（UI 模式、重试、并发控制等）

**验收标准：**
- 运行 `npm test` 等价于 `playwright test`
- 支持 `playwright test --ui`（Playwright UI 模式）
- 支持 `playwright test --headed`（有头浏览器调试）
- 测试文件使用 `import { test, expect, chromium } from "@playwright/test"` 格式
- 测试超时默认 180 秒（适配 LLM 调用）

**示例：**
```bash
cd examples/mdn-blog
npm test          # playwright test
npm run test:ui   # playwright test --ui
npm run test:headed  # playwright test --headed
```

---

### US-2: Stagehand 创建浏览器 + Playwright 连接 CDP

**作为** 开发者  
**我希望** Stagehand 创建浏览器实例，Playwright 通过 CDP 连接同一浏览器  
**以便** Playwright 管理页面生命周期，Stagehand 执行语义操作

**验收标准：**
- `beforeAll` 中 Stagehand `init()` 启动 Chrome
- 通过 `stagehand.connectURL()` 获取 CDP WebSocket URL（公开 API）
- Playwright 通过 `chromium.connectOverCDP(cdpUrl)` 连接同一浏览器
- Playwright 通过 `browser.newPage()` 创建和管理页面
- `afterAll` 中先关闭 Playwright 连接，再关闭 Stagehand（关闭 Chrome）

**示例代码：**
```typescript
test.beforeAll(async () => {
  stagehand = new Stagehand({ env: "LOCAL", ... });
  await stagehand.init();
  const cdpUrl = stagehand.connectURL();
  browser = await chromium.connectOverCDP(cdpUrl);
});
```

---

### US-3: Stagehand act/extract 操作 Playwright 管理的页面

**作为** 开发者  
**我希望** Stagehand 的 `act()`/`extract()` 能操作 Playwright 创建的页面  
**以便** 用 Playwright 导航/断言，用 Stagehand 语义操作，两者无缝配合

**验收标准：**
- `stagehand.act(instruction, { page })` 传入 Playwright Page
- `stagehand.extract(instruction, schema, { page })` 传入 Playwright Page
- Stagehand 内部通过 CDP frame ID 桥接到 V3 Page
- Playwright 和 Stagehand 操作的是同一个页面

**示例代码：**
```typescript
test("点击 Read more", async () => {
  const page = await browser.newPage();
  await page.goto(BLOG_URL);                           // Playwright 导航
  await stagehand.act("点击第一个博客卡片的 Read more 按钮", { page }); // Stagehand 操作
  await expect(page).toHaveURL(/\/blog\/.+/);          // Playwright 断言
  await page.close();
});
```

---

### US-4: 输出 Playwright 原生报告

**作为** 开发者  
**我希望** 测试运行后自动生成 Playwright 报告  
**以便** 可视化查看测试结果、耗时、错误信息

**验收标准：**
- 终端实时输出测试结果（`list` reporter）
- 生成 HTML 报告（`html` reporter），可通过 `npm run test:report` 打开
- 生成 JSON 报告（`json` reporter），输出到 `test-results/results.json`
- 报告包含每个测试的通过/失败状态、耗时、错误堆栈

**示例：**
```bash
npm test            # 运行测试，生成报告
npm run test:report # 浏览器打开 HTML 报告
```

---

### US-5: 失败时自动截图

**作为** 开发者  
**我希望** 测试失败时自动保存截图  
**以便** 快速定位失败原因，无需重新运行测试

**验收标准：**
- `use.screenshot: 'only-on-failure'` 配置生效
- 失败截图保存在 `test-results/<test-name>-chromium/test-failed-1.png`
- 截图包含失败时刻的页面完整视图
- 截图文件不提交到 Git

---

### US-6: 重试时录制 Trace

**作为** 开发者  
**我希望** 测试重试时自动录制 trace  
**以便** 通过 Playwright Trace Viewer 回放完整的操作过程

**验收标准：**
- `retries: 1` + `use.trace: 'on-first-retry'` 配置生效
- 首次运行不录制 trace（减少开销）
- 重试时录制完整 trace（DOM 快照 + 网络请求 + console log）
- trace 文件保存在 `test-results/<test-name>/trace.zip`
- 可通过 `npx playwright show-trace <path>` 打开

**Trace 回退方案：**
- 如果 `use.trace` 在 CDP 模式下不生效，通过 `page.context().tracing.start()` 手动控制

---

### US-7: 缓存可提交 + 二次运行零 LLM

**作为** 开发者  
**我希望** 首次运行后缓存文件可提交到 Git，第二次运行完全不调用 LLM  
**以便** CI 运行快速稳定、零 AI 成本

**验收标准：**
- 首次运行：`act(instruction, { page })` 调用 LLM → 生成选择器 → 写入 `.stagehand-cache/<hash>.json`
- 缓存文件可 `git add` 并提交
- 第二次运行：`act(instruction, { page })` 命中缓存 → 确定性执行 → 零 `claude -p` 调用
- 缓存命中执行耗时 < 200ms/动作

**验证方式：**
```bash
# 首次运行
npm test
# 日志：Claude Code 调用完成 { durationMs: 2100, costUsd: 0.003 }

# 提交缓存
git add .stagehand-cache/
git commit -m "chore(e2e): add selector cache"

# 第二次运行
npm test
# 日志：无 Claude Code 调用 → 全部缓存命中
```

---

### US-8: 核心库零改动

**作为** 维护者  
**我希望** 本次迁移不修改 `src/` 下的任何核心代码  
**以便** 降低风险，确保其他示例和单元测试不受影响

**验收标准：**
- `src/llm-client.ts` — 未修改
- `src/claude-code-model.ts` — 未修改
- `src/self-heal.ts` — 未修改
- `src/report.ts` — 未修改
- `src/types.ts` — 未修改
- `src/index.ts` — 未修改
- `src/logger.ts` — 未修改
- `tests/*.test.ts` — 未修改
- 根目录 `vitest.config.ts` — 未修改
- 仅 `examples/mdn-blog/` 目录发生变更

---

## 2. Demo 脚本

### Demo-1: 首次运行生成缓存 + 报告

```bash
cd examples/mdn-blog
rm -rf .stagehand-cache/    # 确保无缓存
npm test                     # 首次运行（会调用 LLM）

# 预期输出：
# ✓  博客列表页可访问且包含卡片 (5.2s)
# ✓  博客卡片包含完整结构 (3.8s)
# ✓  点击 Read more 进入博客详情 (6.1s)
# 3 passed (15.1s)

ls .stagehand-cache/         # 查看缓存文件
git add .stagehand-cache/    # 提交缓存
npm run test:report          # 打开 HTML 报告
```

### Demo-2: 缓存回放零 LLM

```bash
npm test                     # 第二次运行（应全部命中缓存）

# 预期输出：
# ✓  博客列表页可访问且包含卡片 (1.2s)    ← 更快
# ✓  博客卡片包含完整结构 (0.8s)
# ✓  点击 Read more 进入博客详情 (1.5s)
# 3 passed (3.5s)                          ← 15s → 3.5s
```

### Demo-3: 失败截图 + Trace 回放

```bash
# 临时修改断言使测试失败
npm test

# 查看失败截图
open test-results/*/test-failed-1.png

# 查看 trace
npx playwright show-trace test-results/*/trace.zip
```

### Demo-4: Playwright UI 模式

```bash
npm run test:ui
# 打开 Playwright UI 窗口，可视化调试
```

---

## 3. 验收标准汇总

### 功能验收

- [ ] **US-1**: Playwright 作为测试运行器
  - [ ] `npm test` 调用 `playwright test`
  - [ ] 支持 `--ui` 和 `--headed` 模式

- [ ] **US-2**: Stagehand 创建浏览器 + Playwright 连接 CDP
  - [ ] `stagehand.init()` 启动 Chrome
  - [ ] `stagehand.connectURL()` 返回 CDP WebSocket URL
  - [ ] `chromium.connectOverCDP(cdpUrl)` 连接成功
  - [ ] `afterAll` 正确关闭

- [ ] **US-3**: Stagehand act/extract 操作 Playwright 页面
  - [ ] `act(instruction, { page })` 正常工作
  - [ ] `extract(instruction, schema, { page })` 正常工作
  - [ ] Stagehand 通过 CDP frame ID 桥接到 V3 Page

- [ ] **US-4**: Playwright 原生报告
  - [ ] list + HTML + JSON reporter 正常输出
  - [ ] `npm run test:report` 可打开报告

- [ ] **US-5**: 失败自动截图
  - [ ] 失败时生成截图文件

- [ ] **US-6**: 重试录制 Trace
  - [ ] 重试时生成 trace.zip
  - [ ] 可通过 `show-trace` 打开

- [ ] **US-7**: 缓存可提交 + 零 LLM 回放
  - [ ] 首次运行生成缓存文件
  - [ ] 缓存文件可 git commit
  - [ ] 第二次运行全部命中缓存

- [ ] **US-8**: 核心库零改动
  - [ ] `src/` 下无文件变更

### 性能验收

- [ ] 首次运行总耗时 < 30s（含 LLM 调用）
- [ ] 缓存回放总耗时 < 10s（纯 CDP 操作）
- [ ] 单个缓存命中 `act()` < 200ms

### 兼容性验收

- [ ] 根目录 `npm test`（Vitest 单元测试）不受影响
- [ ] `npm run build` 构建成功
- [ ] `npm run typecheck` 无类型错误

---

**文档结束**
