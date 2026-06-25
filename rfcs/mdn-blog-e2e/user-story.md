# User Stories: MDN Blog E2E 测试示例

**状态：** 待评审
**版本：** 1.0
**日期：** 2026-06-24
**依赖：** SPEC mdn-blog-e2e v1.0

---

## US-1: 验证博客列表页可访问

**作为** E2E 测试开发者，
**我希望** 能验证 MDN Blog 列表页正常加载并包含博客卡片，
**以便** 确认目标页面可用，为后续测试奠定基础。

### 验收标准

- AC-1: 导航到 `https://developer.mozilla.org/en-US/blog/` 后，页面 URL 包含 `/blog/`
- AC-2: 页面中至少存在 1 张博客卡片（article 元素）
- AC-3: 测试在 30 秒内完成

### 示例代码

```typescript
test("博客列表页可访问且包含卡片", async () => {
  const page = stagehand.context.pages()[0];
  await page.goto(BLOG_URL);
  await expect(page).toHaveURL(/\/blog\//);

  const cards = await stagehand.extract(
    "获取页面上所有博客卡片的标题",
    z.array(z.object({ title: z.string().describe("卡片标题") }))
  );
  expect(cards.length).toBeGreaterThan(0);
});
```

---

## US-2: 提取博客卡片结构化数据

**作为** E2E 测试开发者，
**我希望** 能提取博客卡片的完整信息（图片、标题、作者、摘要），
**以便** 验证卡片内容结构完整且格式正确。

### 验收标准

- AC-1: 能提取到至少 1 张卡片的结构化数据
- AC-2: 每张卡片包含非空的 `title`（字符串）
- AC-3: 每张卡片包含非空的 `author`（字符串）
- AC-4: 每张卡片包含非空的 `summary`（字符串）
- AC-5: 每张卡片包含有效的 `link`（URL 格式字符串）

### 示例代码

```typescript
test("博客卡片包含完整结构", async () => {
  const page = stagehand.context.pages()[0];
  await page.goto(BLOG_URL);

  const card = await stagehand.extract(
    "提取第一张博客卡片的信息",
    z.object({
      title: z.string().describe("文章标题"),
      author: z.string().describe("作者名称"),
      summary: z.string().describe("文章摘要"),
      link: z.string().describe("文章链接URL"),
    })
  );

  expect(card.title).toBeTruthy();
  expect(card.author).toBeTruthy();
  expect(card.summary).toBeTruthy();
  expect(card.link).toMatch(/^(https?:\/\/|\/)/);
});
```

---

## US-3: 点击 Read more 导航到博客详情

**作为** E2E 测试开发者，
**我希望** 能通过语义化 `act()` 指令点击 Read more 进入博客详情，
**以便** 验证卡片交互和页面导航功能正常。

### 验收标准

- AC-1: `act("点击第一篇博客的 Read more 链接")` 成功执行
- AC-2: 执行后页面 URL 发生变化（不再是 `/blog/` 列表页）
- AC-3: 详情页包含博客正文内容

### 示例代码

```typescript
test("点击 Read more 进入博客详情", async () => {
  const page = stagehand.context.pages()[0];
  await page.goto(BLOG_URL);

  await stagehand.act("点击第一篇博客的 Read more 链接");

  await expect(page).not.toHaveURL(/\/blog\/$/);
  // 验证详情页有正文内容
  const content = await stagehand.extract(
    "提取页面正文的第一段文字",
    z.object({
      firstParagraph: z.string().describe("博客文章正文的第一段文字"),
    })
  );
  expect(content.firstParagraph).toBeTruthy();
});
```

---

## Demo 脚本

### 前置条件

```bash
# 安装依赖
npm install

# 构建项目
npm run build
```

### 运行示例

```bash
# 运行 MDN Blog E2E 测试（需要网络访问）
npx playwright test examples/mdn-blog/mdn-blog.spec.ts
```

### 预期输出

```
✓ 博客列表页可访问且包含卡片 (8s)
✓ 博客卡片包含完整结构 (6s)
✓ 点击 Read more 进入博客详情 (10s)

3 passed (24s)
```

### 故障排查

| 问题 | 可能原因 | 解决方式 |
|------|----------|----------|
| 页面加载超时 | 网络问题 | 检查网络，增加 timeout |
| extract 返回空 | 页面结构变化 | 更新 e2e-skills/CLAUDE.md |
| act 点击失败 | Read more 被遮挡 | 先关闭 cookie 横幅 |
