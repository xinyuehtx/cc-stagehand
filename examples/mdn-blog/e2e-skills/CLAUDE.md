# MDN Blog E2E Testing Skill Context

## 选择器策略

优先使用以下选择器类型（按稳定性排序）：
1. BEM 风格 CSS class（如 `.blog-post-preview`）
2. HTML 语义标签（如 `<article>`、`<h2>`、`<time>`）
3. `data-variant` 属性（如 `[data-variant="primary"]`）
4. 避免使用 lit 模板注释或动态生成的 class
5. **不要使用 xpath**，始终使用 CSS 选择器

## 页面结构

### 博客列表页 (/en-US/blog/)

每张博客卡片的 DOM 结构：

```
article.blog-post-preview
├── header.blog-post-preview__header
│   ├── figure.blog-post-preview__figure
│   │   └── a[href] > img (卡片封面图)
│   ├── h2 > a[href] (文章标题 + 链接)
│   └── div.blog-post-preview__author-read-time
│       ├── span.blog-post-author (作者名称，可能含 img.blog-post-author__avatar)
│       ├── time.date (发布日期)
│       └── span.read-time (阅读时长)
├── p.blog-post-preview__description (文章摘要)
└── footer.blog-post-preview__footer
    └── a.button[data-variant="primary"] (Read more 按钮)
```

### 已知选择器

| 元素 | 选择器 | 备注 |
|------|--------|------|
| 博客卡片 | `article.blog-post-preview` | 页面包含多张 |
| 卡片标题 | `article.blog-post-preview h2 a` | 文本内容为标题 |
| 标题链接 | `article.blog-post-preview h2 a[href]` | href 为文章路径 |
| 作者 | `.blog-post-author` | 可能是 `<span>` 或 `<a>` |
| 发布日期 | `time.date` | 如 "June 15, 2026" |
| 摘要 | `p.blog-post-preview__description` | 纯文本摘要 |
| Read more 按钮 | `a.button[data-variant="primary"]` | 在 footer 内，**第一个即为第一篇博客的 Read more** |
| 封面图片 | `.blog-post-preview__figure img` | loading="eager" |

### act() 操作指南

当需要点击 "Read more" 按钮时：
- 目标元素是 `article.blog-post-preview` 内 `footer` 中的 `a.button[data-variant="primary"]`
- 如果是"第一个"，选择 `article.blog-post-preview:first-of-type a.button[data-variant="primary"]`
- 该元素是一个 `<a>` 标签，点击后会导航到文章详情页

### 博客详情页 (/en-US/blog/{slug}/)

- 文章标题：页面内的 `<h1>` 元素
- 正文内容：`<article>` 内的段落元素

## 注意事项

- 图片使用 `loading="eager"` 而非懒加载，首屏图片直接渲染
- Read more 按钮使用 `aria-labelledby` 关联标签文本
- 作者可能是内部（`<span>`）或外部链接（`<a>` 带 `target="_blank"`）
- 页面无 cookie 横幅干扰
- lit 模板注释（`<!--lit-part-->`）不影响 DOM 查询

## 错误恢复策略

- 如果 `article.blog-post-preview` 未找到，等待 2 秒后重试（页面可能正在加载）
- 如果 Read more 按钮未找到，尝试匹配卡片 footer 内的任意 `<a>` 链接
- 如果标题提取为空，尝试从 `h2` 的文本内容获取
