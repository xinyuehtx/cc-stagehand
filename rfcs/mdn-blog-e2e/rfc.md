# RFC: MDN Blog E2E 测试示例

**状态：** 待评审
**日期：** 2026-06-24
**包：** `@browserbasehq/stagehand-skill-agent`
**作者：** canxing

---

## 问题陈述

当前项目 `examples/` 目录下有两个示例：

- `basic-test/` — 登录流程（虚拟域名，act 指令演示）
- `self-heal/` — 自愈场景（虚拟域名，自愈机制演示）

两个示例都使用虚拟域名 `app.example.com`，无法实际运行。缺少一个针对**真实网站**的 E2E 示例，用于演示：

1. 对真实页面的内容提取与验证
2. `act()` + `extract()` 的组合使用
3. 真实网站的选择器策略与 skill 编写

## 目标

在 `examples/mdn-blog/` 下创建一组针对 MDN Blog（`https://developer.mozilla.org/en-US/blog/`）的 E2E 测试，覆盖以下场景：

- 打开博客列表页，验证页面可访问
- 验证博客卡片结构（图片、标题、作者、摘要）
- 点击 Read more 进入博客详情

## 方案选择

| 方案 | 描述 | 优劣 |
|------|------|------|
| A. 单文件线性测试 | 一个 spec，所有步骤顺序执行 | 简单但不利于独立验证 |
| **B. 分场景多测试（选定）** | 多个 `test()` 用例，各自独立验证 | 职责单一，便于调试，展示更多 API |
| C. 数据驱动提取 | 重点展示 extract 数据抓取 | 覆盖面窄 |

**决策：方案 B** — 分场景多测试，同时展示 `act()` 和 `extract()` 能力。

## 架构设计

### 目录结构

```
examples/mdn-blog/
├── mdn-blog.spec.ts          # E2E 测试用例
└── e2e-skills/
    └── CLAUDE.md              # MDN Blog 页面选择器知识
```

### 测试用例设计

三个独立的 `test()` 用例：

#### Test 1: 博客列表页加载

- 打开 `https://developer.mozilla.org/en-US/blog/`
- 验证页面 URL 包含 `/blog/`
- 验证博客卡片列表存在（至少 1 张卡片）

#### Test 2: 博客卡片内容提取

- 打开博客列表页
- 使用 `extract()` 提取第一张卡片的结构化数据（图片、标题、作者、摘要）
- 验证各字段非空、格式正确

#### Test 3: 点击 Read more 进入详情

- 打开博客列表页
- 使用 `act()` 点击第一张卡片的 Read more 按钮
- 验证页面导航到博客详情页（URL 变化）
- 验证详情页包含博客正文内容

### Skill 文件（e2e-skills/CLAUDE.md）

为 Claude Code 提供 MDN Blog 页面的选择器知识：

- 博客卡片容器选择器
- 卡片内各元素选择器（图片、标题、作者、摘要）
- Read more 按钮选择器
- 页面加载注意事项（如图片懒加载）

## 影响范围

- **新增文件：** 2 个（spec + CLAUDE.md）
- **修改文件：** 无
- **依赖变更：** 无（复用现有 `@browserbasehq/stagehand` + `@playwright/test`）

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| MDN 页面结构变更导致选择器失效 | 中 | 测试失败 | skill 文件中记录多种选择器策略；利用自愈机制 |
| 网络延迟导致超时 | 低 | 测试失败 | 增加 timeout 配置 |
| 图片懒加载导致提取失败 | 中 | 断言失败 | 先滚动到可见区域再提取 |

## 开放问题

1. MDN Blog 页面是否使用 `data-testid`？需要实际查看页面结构确认
2. 是否需要在测试前预热缓存（preheat）？
