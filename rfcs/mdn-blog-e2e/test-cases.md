# Test Cases: MDN Blog E2E 测试示例

**状态：** 待评审
**版本：** 1.0
**日期：** 2026-06-24
**依赖：** User Story mdn-blog-e2e v1.0

---

## 测试分层说明

本功能的测试全部为 **E2E 集成测试**，位于 `examples/mdn-blog/` 目录下（vitest 已排除 examples），使用 Playwright 作为测试运行器，依赖真实网络和 Claude Code LLM。

> 注：单元测试（vitest）不适用于本示例，因为不涉及新的源码模块。

---

## TC-1: 博客列表页加载验证

### TC-1.1: 页面可访问

| 项目 | 内容 |
|------|------|
| **关联** | US-1 AC-1 |
| **前置条件** | Stagehand 已初始化，网络可访问 MDN |
| **测试步骤** | 1. `page.goto(BLOG_URL)` |
| **期望结果** | 页面 URL 包含 `/blog/`，无 JS 错误 |

### TC-1.2: 卡片列表非空

| 项目 | 内容 |
|------|------|
| **关联** | US-1 AC-2 |
| **前置条件** | 页面已导航到博客列表 |
| **测试步骤** | 1. `page.goto(BLOG_URL)` <br> 2. `stagehand.extract("获取页面上所有博客卡片的标题", z.array(z.object({ title: z.string() })))` |
| **期望结果** | 返回数组长度 > 0 |

### TC-1.3: 超时处理

| 项目 | 内容 |
|------|------|
| **关联** | US-1 AC-3 |
| **前置条件** | 网络延迟或不可达 |
| **测试步骤** | 1. 设置 test timeout 为 30s <br> 2. `page.goto(BLOG_URL, { timeout: 15000 })` |
| **期望结果** | 超时时抛出明确错误，不无限等待 |

---

## TC-2: 博客卡片内容提取

### TC-2.1: 提取单张卡片完整数据

| 项目 | 内容 |
|------|------|
| **关联** | US-2 AC-1 ~ AC-5 |
| **前置条件** | 页面已导航到博客列表，至少 1 张卡片可见 |
| **测试步骤** | 1. `page.goto(BLOG_URL)` <br> 2. `stagehand.extract("提取第一张博客卡片的信息", z.object({ title: z.string(), author: z.string(), summary: z.string(), link: z.string() }))` |
| **期望结果** | 返回对象包含 title、author、summary、link 四个字段 |

### TC-2.2: 字段非空验证

| 项目 | 内容 |
|------|------|
| **关联** | US-2 AC-2 ~ AC-4 |
| **前置条件** | TC-2.1 的 extract 结果 |
| **测试步骤** | 对返回对象逐个断言 `.toBeTruthy()` |
| **期望结果** | title、author、summary 均为非空字符串 |

### TC-2.3: 链接格式验证

| 项目 | 内容 |
|------|------|
| **关联** | US-2 AC-5 |
| **前置条件** | TC-2.1 的 extract 结果 |
| **测试步骤** | 断言 `link` 匹配 `/^https?:\/\//` 或为相对路径 |
| **期望结果** | link 为有效 URL |

---

## TC-3: 点击 Read more 进入详情

### TC-3.1: act 点击成功

| 项目 | 内容 |
|------|------|
| **关联** | US-3 AC-1 |
| **前置条件** | 页面已导航到博客列表 |
| **测试步骤** | 1. `page.goto(BLOG_URL)` <br> 2. `stagehand.act("点击第一篇博客的 Read more 链接")` |
| **期望结果** | act() 正常返回，无异常抛出 |

### TC-3.2: 页面导航验证

| 项目 | 内容 |
|------|------|
| **关联** | US-3 AC-2 |
| **前置条件** | TC-3.1 执行后 |
| **测试步骤** | 断言当前 URL 不再是 `BLOG_URL` |
| **期望结果** | URL 已变化，指向具体博客文章 |

### TC-3.3: 详情页内容验证

| 项目 | 内容 |
|------|------|
| **关联** | US-3 AC-3 |
| **前置条件** | 页面已导航到博客详情 |
| **测试步骤** | `stagehand.extract("提取页面正文的第一段文字", z.object({ firstParagraph: z.string() }))` |
| **期望结果** | 返回非空字符串，为博客正文内容 |

---

## 测试执行策略

### 共享设置

```typescript
// beforeAll: stagehand.init() — 一次性初始化浏览器
// afterAll:  stagehand.close() — 测试结束后关闭
// 每个 test 独立 page.goto()，保证隔离
```

### Timeout 配置

| 级别 | 值 | 说明 |
|------|-----|------|
| test 级别 | 60s | 包含 LLM 调用，需宽裕 |
| page.goto | 15s | 页面加载超时 |
| act/extract | 30s | 单次 LLM 操作超时 |

### CI 注意事项

- 需要网络访问 `developer.mozilla.org`
- 首次运行产生 LLM 成本，后续走 Stagehand 缓存（零成本）
- CI 环境需确保 `claude` CLI 可用（或已预热缓存）
