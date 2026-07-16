# MDN Blog E2E Testing Skill Context

## 输出格式要求

当你收到浏览器自动化指令时，你 MUST 返回纯 JSON（无 markdown、无解释文本）。

### act() 响应格式示例

```json
{
  "action": {
    "elementId": "0-5",
    "description": "Read more link in the first blog card footer",
    "method": "click",
    "arguments": [],
    "cssSelector": "article:first-of-type footer a"
  },
  "twoStep": false
}
```

**cssSelector 字段规则：**
- ✅ 必须包含：`"cssSelector": "article:first-of-type footer a"`
- ✅ 使用语义标签：article, section, footer, header, nav, main
- ✅ 使用 :first-of-type / :nth-of-type(n) 进行位置区分
- ❌ 禁止 xpath 格式
- ❌ 禁止省略此字段

## 选择器策略

优先使用语义化 CSS 选择器：
1. HTML 语义标签（如 `<article>`、`<h2>`、`<time>`）
2. BEM 风格 CSS class（如 `.blog-post-preview`）
3. **不要使用 xpath**，始终使用 CSS 选择器
4. 避免过于具体的复合选择器，优先使用简洁稳定的选择器

## 页面结构

### 博客列表页 (/en-US/blog/)

- 页面包含多张博客卡片，每张卡片是一个 `<article>` 元素
- 每张卡片包含：标题（带链接）、作者、发布日期、摘要、Read more 按钮
- Read more 按钮是一个 `<a>` 标签链接，位于卡片底部，点击后导航到文章详情页

### 博客详情页 (/en-US/blog/{slug}/)

- 文章标题在页面的 `<h1>` 元素中
- 正文内容在 `<article>` 元素内的段落中

## 注意事项

- 图片使用 `loading="eager"`，首屏图片直接渲染
- 页面无 cookie 横幅干扰
- lit 模板注释（`<!--lit-part-->`）不影响 DOM 查询

## 错误恢复策略

- 如果预期元素未找到，等待 2 秒后重试（页面可能正在加载）
- 如果某个选择器失效，尝试用更语义化的方式定位元素
