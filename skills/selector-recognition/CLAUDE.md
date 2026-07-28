# Skill: Stable Selector Recognition (general-purpose)

> 通用「选择器识别」skill。将它放到 `createClaudeCodeLLMClient({ cwd })` 指向的目录
> （或拷贝进你项目的 `e2e-skills/`）。目标：为任意网站的 `act()` 生成**稳定、可泛化、
> 抗前端重构**的 CSS 选择器。
>
> 与 [`../e2e-authoring/CLAUDE.md`](../e2e-authoring/CLAUDE.md) 搭配使用：本文管「怎么定位元素」，
> 那份管「怎么写用例」。

## 1. 输出格式（MUST）

收到浏览器自动化指令时，**只返回纯 JSON**，不要 markdown 代码块、不要解释文字。
`act()` 响应必须包含 `cssSelector` 字段：

```json
{
  "action": {
    "elementId": "0-5",
    "description": "Primary submit button in the checkout form",
    "method": "click",
    "arguments": [],
    "cssSelector": "form[aria-label='Checkout'] button[type='submit']"
  },
  "twoStep": false
}
```

- ✅ `cssSelector` 必填、非空
- ❌ 禁止 `xpath=` 前缀 / `/html/...` 绝对路径
- ❌ 禁止省略该字段（缺失会被拒绝）

## 2. 选择器优先级阶梯（从高到低）

**从上往下**取第一个能在当前页面**唯一命中**目标的方案。这与 Playwright 官方推荐的
定位优先级一致（面向用户可见/语义属性，而非 DOM 结构）：

1. **专用测试属性** — `[data-testid="..."]`、`[data-test="..."]`、`[data-cy="..."]`
2. **ARIA 角色 + 可见名称** — `[role="button"]` 且文本/可及名匹配（对应 Playwright `getByRole`）
3. **可访问性属性** — `[aria-label="..."]`、`[aria-labelledby]`、`[name="..."]`（表单）
4. **稳定的语义属性** — `<a href>`、`<button type>`、`<input type>`、`placeholder`、`alt`
5. **语义化 HTML 标签** — `main`、`nav`、`header`、`footer`、`article`、`section`、`h1`~`h3`、`time`
6. **有业务含义的稳定 class** — 如 `.product-card`、`.checkout-form`（**不含 hash**）
7. **位置伪类兜底** — `:first-of-type` / `:nth-of-type(n)` 区分同类元素

> 经验法则：**能用用户能感知的属性（角色、文本、标签、testid）定位，就不要用 DOM 结构定位。**

## 3. 坚决避免的脆弱写法（framework 陷阱）

前端框架会生成**每次构建都变**的类名/属性，禁止用它们定位：

- ❌ CSS Modules / styled-components 哈希：`.css-1a2b3c`、`.sc-bdVaJa`、`._1x2Y3z`
- ❌ CSS-in-JS / JSX 运行时类：`.jsx-987654321`、`.MuiButton-root-123`
- ❌ Vue scoped 属性：`[data-v-7ba5bd90]`
- ❌ Angular 视图封装：`[_ngcontent-abc-c12]`、`.ng-tns-c45-3`
- ❌ 绝对/深层结构：`div > div > div:nth-child(3) > span`、`xpath=/html/body/...`
- ❌ `:nth-child()`（对文本节点/注释/条件渲染敏感）→ 改用 `:nth-of-type()`
- ❌ 把易变文案当选择器值（除非 `aria-label` / testid 本身稳定）

## 4. 稳定性与唯一性规则

- ✅ **越短越语义化越好**：`nav a[href="/pricing"]` 优于四层后代嵌套
- ✅ 组合「语义标签 + 稳定属性」提升唯一性：`article:first-of-type footer a`
- ✅ 需要「第 N 个」时用 `:nth-of-type(n)` 表达，而非依赖视觉顺序
- ✅ 选择器必须**只命中一个**目标元素；命中多个要继续收窄
- ✅ 优先匹配**文档结构与语义**，而非像素位置

## 5. 与 Stagehand `observe()` / `act()` 的关系

- `observe("...")` 会返回**候选元素及建议动作/选择器**；可先用它探查页面，
  再让 `act()` 执行——有助于产出更稳的 `cssSelector`。
- `act()` 的选择器一旦被本库缓存并泛化，后续运行零 LLM 直接回放；
  因此**选择器越泛化、越语义化，缓存命中期就越长**（更抗前端小改）。

## 6. 生成前自检（Self-check）

产出 `cssSelector` 前逐条确认：

1. 它在当前页面**只命中一个**目标元素吗？
2. 是否已选用阶梯中**尽量靠上**的方案（testid/role > 结构）？
3. 是否**不含** xpath、hash class、`:nth-child`、超过 3 层的深层嵌套？
4. 换一批数据 / 前端做小重构后，它**大概率仍然有效**吗？

若任一项为「否」，回到阶梯上一档重新定位。

## 7. 错误恢复策略

- 预期元素未找到：等待约 2 秒后重试（可能仍在加载 / 异步渲染）
- 选择器失效：退回更语义化的方案（testid → role → 语义标签）重新定位
- 动态列表：优先用「容器语义 + `:nth-of-type`」而非绝对索引
