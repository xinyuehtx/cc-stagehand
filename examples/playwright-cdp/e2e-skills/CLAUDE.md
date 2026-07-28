# Playwright CDP + Qodercli E2E Testing Skill Context

> 该文件是「业务 skill 知识库」，Agent 在生成选择器时会读取它。
> 目标：产出**稳定、可泛化、能扛前端重构**的 CSS 选择器。

## 1. 输出格式（MUST）

收到浏览器自动化指令时，**只返回纯 JSON**，不要 markdown 代码块、不要解释文字。

### `act()` 响应格式

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

**`cssSelector` 字段是强制的**：
- ✅ 必须包含该字段，且为非空字符串
- ❌ 禁止 `xpath=` 前缀或 `/html/...` 绝对路径
- ❌ 禁止省略此字段（缺失将被拒绝）

## 2. 选择器优先级阶梯（从高到低）

生成 `cssSelector` 时，**从上往下**选择第一个能唯一命中目标的方案：

1. **稳定测试属性** — `[data-testid="..."]`、`[data-test="..."]`
2. **可访问性属性** — `[aria-label="..."]`、`[role="..."]` + 可见名称
3. **语义化 HTML 标签** — `article`、`section`、`nav`、`header`、`footer`、`main`、`aside`、`h1`~`h3`、`time`
4. **稳定语义 class** — 具业务含义的 BEM class（如 `.blog-post-preview`），**不含 hash 后缀**
5. **位置伪类兜底** — `:first-of-type` / `:nth-of-type(n)` 用于区分同类元素

## 3. 稳定性规则（避免脆弱选择器）

- ✅ 越短越好，优先语义标签 + 位置伪类的组合
- ✅ 用 `:first-of-type` / `:nth-of-type(2)` 表达「第几个」
- ❌ 不要用带 hash 的 class：`.css-1a2b3c`、`.jsx-98765`
- ❌ 不要用超过 3 层的后代嵌套
- ❌ 不要用 `:nth-child()`，改用 `:nth-of-type()`

## 4. 页面结构参考

### 博客列表页 `/en-US/blog/`
- 每张博客卡片是一个 `<article>` 元素
- 卡片内含：标题、作者、发布日期（`<time>`）、摘要、**Read more 链接**（卡片底部 `<footer>` 内的 `<a>`）
- 卡片可能使用 `.blog-post-preview` 或类似语义 class

### 博客详情页 `/en-US/blog/{slug}/`
- 文章标题在 `<h1>`
- 正文在 `<article>` 内的 `<p>` 段落中，含作者信息与发布日期等元数据

## 5. 生成前自检（Self-check）

1. 该选择器是否在当前页面**只命中一个**目标元素？
2. 是否已选用阶梯中**尽可能靠上**的方案？
3. 是否**不含** xpath、hash class、`:nth-child`、超深嵌套？
4. 前端小改后它**是否仍然有效**？

## 6. 错误恢复策略

- 预期元素未找到：等待约 2 秒后重试
- 某选择器失效：回到阶梯上一档，用更语义化的方式重新定位
- 始终**优先匹配文档结构**，而非视觉位置
