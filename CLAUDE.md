# CLAUDE.md — Stagehand Claude Code Skill Agent

## 项目概述

`@browserbasehq/stagehand-skill-agent` — 使用 Claude Code (`claude -p`) 作为 Stagehand E2E 测试框架的 LLM 执行引擎，结合业务 skill 知识生成高泛化性选择器，通过缓存机制实现 CI 稳定性。

**核心能力：**
- 语义化 `act()` 指令 → Claude Code 生成选择器 → 缓存 → CI 零成本回放
- 自愈机制：选择器失效时自动重新生成 + git commit
- 双日志策略：本地文件 / CI stdout

## 技术栈

- **语言：** TypeScript (ES2022, NodeNext)
- **测试框架：** Vitest
- **构建：** tsc
- **运行时：** Node.js >= 18
- **依赖：** `@browserbasehq/stagehand` (peer), `claude` CLI (系统依赖)

## 常用命令

```bash
# 构建
npm run build

# 测试
npm test               # 单次运行
npm run test:watch     # watch 模式
npm run test:coverage  # 覆盖率

# 类型检查
npm run typecheck
```

## 项目结构

```
├── src/                        # 源码
│   ├── index.ts                # 公共 API 入口
│   ├── types.ts                # 类型定义
│   ├── llm-client.ts           # ClaudeCodeLLMClient
│   ├── claude-code-model.ts    # ClaudeCodeLanguageModel (内部)
│   ├── logger.ts               # 双日志策略
│   ├── self-heal.ts            # SelfHealTracker
│   └── report.ts               # E2EReport
├── tests/                      # 单元测试 + 集成测试
├── examples/                   # 示例（每个含独立 skill 目录）
│   ├── basic-test/             # 基础 E2E 测试
│   │   ├── basic-test.spec.ts
│   │   └── e2e-skills/CLAUDE.md
│   ├── self-heal/              # 自愈场景
│   │   ├── self-heal.spec.ts
│   │   └── e2e-skills/CLAUDE.md
│   └── preheat-selectors/      # 缓存预热脚本
│       ├── preheat-selectors.ts
│       └── e2e-skills/CLAUDE.md
├── rfcs/                       # RFC / SPEC / User Story 文档
│   └── claude-code-llm-client/ # 已批准的 RFC 文档集
│       ├── rfc.md
│       ├── spec.md
│       └── user-story.md
├── .github/workflows/          # CI + npm 发布流水线
│   ├── ci.yml
│   └── publish.yml
├── README.md                   # 中英文双语 README
└── CLAUDE.md                   # 本文件
```

## 开发工作流

**每个功能/需求必须严格按以下阶段推进。每个阶段完成后需要用户确认（"待评审"），确认后才能进入下一阶段。**

### Phase 1: 脑暴 (Brainstorm)

当用户提出一个想法或需求时：

1. **分析需求本质**：理解用户真正要解决的问题
2. **提出 2-4 个可选方案**：每个方案包含
   - 方案名称和简要描述
   - 优势与劣势
   - 实现复杂度评估
   - 对现有架构的影响
3. **给出推荐方案**及理由
4. **等待用户选择**后才进入下一阶段

### Phase 2: RFC 编写

用户选定方案后，编写 RFC 文档：

1. **创建目录**：`rfcs/{feature-name}/`
2. **编写 RFC**：`rfcs/{feature-name}/rfc.md`
   - 问题陈述
   - 方案选择与决策
   - 架构设计
   - 影响范围
   - 风险与缓解
   - 开放问题
3. **标记状态为"待评审"** — 等待用户确认后才能进入 SPEC 阶段

### Phase 3: SPEC 编写

RFC 评审通过后，编写技术规格文档：

1. **编写 SPEC**：`rfcs/{feature-name}/spec.md`
   - 公共 API 设计（接口、类型、函数签名）
   - 数据结构定义
   - 实现细节（伪代码/关键代码片段）
   - 错误处理策略
   - 性能考量
   - 兼容性说明
2. **标记状态为"待评审"** — 等待用户确认后才能进入用户故事阶段

### Phase 4: 用户故事编写

SPEC 评审通过后，编写用户故事：

1. **编写用户故事**：`rfcs/{feature-name}/user-story.md`
   - 每个 User Story 遵循 `作为...我希望...以便...` 格式
   - 明确验收标准（可测试的条件列表）
   - 示例代码/使用场景
   - Demo 脚本
2. **标记状态为"待评审"** — 等待用户确认后才能进入测试用例阶段

### Phase 5: 测试用例编写

用户故事评审通过后，编写测试用例：

1. **更新测试文档**：在 `rfcs/{feature-name}/user-story.md` 的 Test Cases 部分或单独文件
2. **测试分层**：
   - **单元测试**：mock 外部依赖，验证纯逻辑
   - **集成测试**：组件间交互，mock 外部服务
   - **E2E 测试**：端到端流程验证
3. **每个测试用例包含**：
   - 测试名称和描述
   - 前置条件
   - 测试步骤
   - 期望结果
4. **标记状态为"待评审"** — 等待用户确认后才能进入实现阶段

### Phase 6: SDD + TDD 实现

测试用例评审通过后，按 SDD + TDD 方式实现：

1. **SDD (Spec-Driven Development)**：
   - 对照 SPEC 中的 API 设计，先定义类型和接口
   - 确保所有公共 API 与 SPEC 一致
2. **TDD (Test-Driven Development)**：
   - **Red**：先编写失败的测试
   - **Green**：编写最小实现使测试通过
   - **Refactor**：重构代码，保持测试通过
3. **实现顺序**：
   - 类型定义 → 核心逻辑 → 辅助功能 → 集成
4. **每次提交前确保**：
   - `npm run typecheck` 通过
   - `npm test` 全部通过
   - 无 lint 错误

### Phase 7: 验证与质量保证

实现完成后，进行全面验证：

1. **测试验证**：`npm test` — 所有测试通过
2. **类型检查**：`npm run typecheck` — 无类型错误
3. **构建验证**：`npm run build` — 构建成功
4. **代码质量**：检查代码风格、注释完整性
5. **边界情况**：验证错误处理、超时、边界条件

### Phase 8: Demo 编写

验证通过后，编写 Demo：

1. **在 `examples/` 目录创建 Demo 子目录**，包含独立的 `e2e-skills/CLAUDE.md`
2. **Demo 应覆盖**：
   - 基础用法
   - 进阶场景（如自愈、CI 集成）
   - 边界情况处理
3. **Demo 代码必须可运行**，包含必要的注释说明
4. **运行 Demo 进行端到端验证**

### Phase 9: 文档更新

Demo 验证通过后，更新文档：

1. **README.md**：
   - 项目简介和特性概述
   - 安装说明
   - 快速开始示例
   - API 概览
   - 配置说明
   - 贡献指南
2. **API 文档**：
   - 完整的类型定义说明
   - 每个公共 API 的详细文档
   - 示例代码
3. **GitHub Pages**：
   - 更新项目站点
   - 确保文档站点可访问

## 阶段状态标记

每个文档在头部标注状态：

```markdown
**状态：** 待评审 | 已批准 | 实现中 | 已完成
```

**阶段流转规则：**

```
脑暴 → RFC (待评审) → SPEC (待评审) → User Story (待评审) → 测试用例 (待评审) → SDD+TDD 实现 → 验证 → Demo → 文档更新
```

每个"待评审"阶段必须等待用户确认后，才能进入下一阶段。

## 代码规范

- **模块系统：** ESM (NodeNext)
- **文件命名：** kebab-case (如 `llm-client.ts`)
- **类型导出：** 所有公共类型从 `types.ts` 定义，通过 `index.ts` 导出
- **注释：** 公共 API 使用 JSDoc 注释
- **错误处理：** 使用有意义的错误消息，包含上下文信息
- **日志：** 通过 `Logger` 类输出，不使用 `console.log`

## 发布流程

1. 确保所有测试通过：`npm test && npm run typecheck && npm run build`
2. 更新 `package.json` 中的版本号
3. 创建 git tag：`git tag v{version}`
4. 推送 tag：`git push origin v{version}`
5. GitHub Action (`publish.yml`) 自动发布到 npm

