# Playwright CDP + Qodercli E2E Testing Skill Context

## 选择器策略

优先级顺序：
1. HTML 语义标签（`<article>`、`<h2>`、`<time>`、`<nav>`）
2. BEM 风格 CSS class（如 `.blog-post-preview`）
3. **不要使用 xpath**，始终使用 CSS 选择器
4. 避免过于具体的复合选择器（超过 3 层嵌套）
5. 使用 :first-of-type / :nth-of-type() 进行位置区分

## 页面结构

### 博客列表页 (/en-US/blog/)
- 页面包含多张博客卡片，每张卡片是一个 `<article>` 元素
- 每张卡片包含：标题（带链接）、作者、发布日期、摘要、Read more 按钮
- 卡片通常使用 `.blog-post-preview` 或类似 class

### 博客详情页 (/en-US/blog/{slug}/)
- 文章标题在 `<h1>` 元素中
- 正文内容在 `<article>` 元素内的段落中
- 包含作者信息、发布日期等元数据

## 错误恢复策略
- 如果预期元素未找到，等待 2 秒后重试（页面可能正在加载）
- 如果某个选择器失效，尝试用更语义化的方式定位元素
- 优先匹配文档结构而非视觉位置
