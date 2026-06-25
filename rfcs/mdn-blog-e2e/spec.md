# SPEC: MDN Blog E2E 测试示例 — 技术规格

**状态：** 待评审
**版本：** 1.0
**日期：** 2026-06-24
**依赖：** RFC mdn-blog-e2e v1

---

## 1. 公共 API

本示例不引入新的公共 API。复用现有 `@browserbasehq/stagehand-skill-agent` 导出的：

- `createClaudeCodeLLMClient(options)` — 创建 LLM 客户端
- `Stagehand` — 从 `@browserbasehq/stagehand` 导入

## 2. 数据结构

### 博客卡片提取数据结构（extract 使用，配合 Zod schema）

```typescript
import { z } from "zod";

const blogCardSchema = z.object({
  /** 文章标题 */
  title: z.string().describe("博客卡片的文章标题"),
  /** 作者名称 */
  author: z.string().describe("博客文章的作者名称"),
  /** 文章摘要 */
  summary: z.string().describe("博客卡片的摘要描述文字"),
  /** 文章链接 URL */
  link: z.string().describe("博客文章的链接地址"),
});

// extract 调用方式
const card = await stagehand.extract(
  "提取第一张博客卡片的信息",
  blogCardSchema
);
```

## 3. 文件设计

### 3.1 `examples/mdn-blog/mdn-blog.spec.ts`

```typescript
import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import { createClaudeCodeLLMClient } from "@browserbasehq/stagehand-skill-agent";

const BLOG_URL = "https://developer.mozilla.org/en-US/blog/";

const stagehand = new Stagehand({
  env: "LOCAL",
  llmClient: createClaudeCodeLLMClient({
    claudeArgs: ["--project-dir", "./examples/mdn-blog/e2e-skills"],
    logLevel: "info",
  }),
  cacheDir: "./.stagehand-cache",
});

// beforeAll: stagehand.init()
// afterAll: stagehand.close()

// Test 1: "博客列表页可访问且包含卡片"
//   - page.goto(BLOG_URL)
//   - expect URL contains "/blog/"
//   - stagehand.extract("获取页面上所有博客卡片的信息") → 非空数组

// Test 2: "博客卡片包含完整结构"
//   - page.goto(BLOG_URL)
//   - stagehand.extract(提取第一张卡片的 title, author, summary, link)
//   - 断言每个字段非空字符串
//   - 断言 link 为有效 URL

// Test 3: "点击 Read more 进入博客详情"
//   - page.goto(BLOG_URL)
//   - stagehand.act("点击第一篇博客的 Read more 链接")
//   - expect URL !== BLOG_URL（导航到新页面）
//   - 验证详情页存在正文内容
```

### 3.2 `examples/mdn-blog/e2e-skills/CLAUDE.md`

为 Claude Code 提供 MDN Blog 页面的领域知识，包含：

- 页面结构描述
- 已知元素选择器（基于实际页面结构）
- 选择器策略优先级
- 注意事项（懒加载、响应式布局等）

```markdown
# MDN Blog E2E Testing Skill Context

## 选择器策略
优先使用 CSS 选择器，避免依赖动态生成的 class 名。

## 已知元素

### 博客列表页 (/en-US/blog/)
- 博客卡片: article 元素
- 卡片标题: article 内的 h2 或 heading 元素
- 卡片作者: 作者文本区域
- 卡片摘要: 描述段落
- Read more 链接: 卡片内的 "Read more" 链接
- 卡片图片: article 内的 img 元素

## 注意事项
- 图片可能使用懒加载（loading="lazy"）
- 页面可能有 cookie 提示横幅
- Read more 可能是 <a> 标签或按钮
```

## 4. 错误处理策略

| 场景 | 处理方式 |
|------|----------|
| 页面加载超时 | test 级别设置 30s timeout |
| extract 返回空数组 | 断言失败，输出实际值便于调试 |
| Read more 点击后未导航 | 检查 URL 变化，失败时输出当前 URL |
| cookie 横幅遮挡 | act() 先关闭 cookie 横幅（如出现） |

## 5. 性能考量

- 三个测试共享同一个 Stagehand 实例（beforeAll/afterAll），避免重复初始化浏览器
- 每个测试独立导航到博客页，保证测试间隔离
- extract 调用会触发 Claude Code LLM，首次运行有 LLM 成本，后续走缓存

## 6. 兼容性

- Stagehand ≥ 3.6.0
- Playwright ≥ 1.40.0
- Node.js ≥ 18.0.0
- 需要网络访问 MDN（CI 环境需确保可访问外网）
