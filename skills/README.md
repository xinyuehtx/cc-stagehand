# Skills Library — 通用初始 skill

这里提供开箱即用的**通用 skill 知识库**，可直接用于任意网站的 E2E 测试，
无需从零编写业务 skill。

| Skill | 作用 | 适用对象 |
|-------|------|----------|
| [`selector-recognition/`](./selector-recognition/CLAUDE.md) | 生成稳定、可泛化、抗前端重构的 CSS 选择器 | 运行时 `act()` 的选择器生成 |
| [`e2e-authoring/`](./e2e-authoring/CLAUDE.md) | 编写高质量、低 flaky 的 E2E 用例（Playwright + Stagehand 最佳实践） | 编写 `*.spec.ts` 的人 / AI 编码助手 |

> 两者互补：`selector-recognition` 管「怎么定位元素」，`e2e-authoring` 管「怎么设计与编写用例」。

## 用法一：直接把 skill 目录设为 `cwd`

`createClaudeCodeLLMClient({ cwd })` 会从 `cwd` 及其父目录发现 `CLAUDE.md`。
最简单的方式是把某个 skill 目录设为 `cwd`：

```ts
import { createClaudeCodeLLMClient } from "@tengxiaohtx/stagehand-cc-agent";

const llmClient = createClaudeCodeLLMClient({
  // 直接复用内置的通用选择器识别 skill
  cwd: "node_modules/@tengxiaohtx/stagehand-cc-agent/skills/selector-recognition",
  systemPromptEnhancement: "Prefer data-testid, then ARIA role, then semantic tags.",
});
```

## 用法二：拷贝到你自己的 skill 目录再定制（推荐）

把通用 skill 拷进项目，再补充**你自己网站的页面结构与已知元素**：

```bash
mkdir -p e2e-skills
cp node_modules/@tengxiaohtx/stagehand-cc-agent/skills/selector-recognition/CLAUDE.md e2e-skills/CLAUDE.md
# 然后在 e2e-skills/CLAUDE.md 末尾追加你项目的「页面结构 / 已知元素」小节
```

```ts
const llmClient = createClaudeCodeLLMClient({ cwd: "./e2e-skills" });
```

## 用法三：作为 AI 编码助手的上下文

编写 `*.spec.ts` 时，把 [`e2e-authoring/CLAUDE.md`](./e2e-authoring/CLAUDE.md)
作为上下文喂给你的 AI 编码助手（Claude Code / Cursor 等），
它就会按 Playwright + Stagehand 的最佳实践产出用例。

## 定制建议

- 通用 skill 覆盖「策略与规则」；**站点特有信息**（页面结构、已知 selector、登录流程等）
  应由你在拷贝后补充，效果最佳。
- 参考 [`../examples/mdn-blog/e2e-skills/CLAUDE.md`](../examples/mdn-blog/e2e-skills/CLAUDE.md)
  看一个「通用规则 + 站点结构」结合的真实例子。
