# @tengxiaohtx/stagehand-cc-agent

**Claude Code as LLM execution engine for Stagehand E2E testing.**

[English](./README.md) | [中文](./README.zh-CN.md)

📖 **[Documentation site & live Playwright screenshots →](https://xinyuehtx.github.io/cc-stagehand/)**

---

## What is this?

`@tengxiaohtx/stagehand-cc-agent` is a custom `LLMClient` for [Stagehand](https://github.com/browserbase/stagehand) that replaces the default LLM with **Claude Code** (`claude -p`). It combines business skill knowledge with Claude Code's reasoning capabilities to generate high-quality, generalizable selectors for E2E tests.

## Why?

Stagehand's default LLM (GPT-4.1-mini) often generates fragile selectors (XPath, hashed CSS classes) that break on every frontend refactor. This package solves that by:

1. **Better selector quality** — Claude Code + skill docs produce selectors using `data-testid` and `aria-label` (~80% of the time), which survive frontend refactors.
2. **Zero-cost CI** — Selectors are cached on first run and committed to Git. CI runs are pure deterministic CDP replay with zero LLM calls.
3. **Self-healing** — When a cached selector fails, Claude Code automatically regenerates it and creates a fix commit.

## How it works

```
Developer writes:    stagehand.act("click the login button")
                              │
                              ▼
First run:           Claude Code + skill docs → [data-testid="login-btn"] → cache
                              │
                              ▼
CI runs:             Cache hit → deterministic CDP execution (0ms LLM, $0 cost)
                              │
                              ▼
Selector breaks:     Claude Code re-generates → [aria-label="Sign In"] → git commit
```

## Installation

```bash
npm install @tengxiaohtx/stagehand-cc-agent
```

**Prerequisites:**
- Node.js >= 20
- `claude` CLI installed and available in PATH
- `@browserbasehq/stagehand` >= 3.6.0

## Quick Start

```typescript
import { Stagehand } from "@browserbasehq/stagehand";
import { createClaudeCodeLLMClient } from "@tengxiaohtx/stagehand-cc-agent";

const stagehand = new Stagehand({
  env: "LOCAL",
  llmClient: createClaudeCodeLLMClient({
    systemPromptEnhancement: `
      Prefer data-testid attributes, then aria-label, then XPath.
    `,
    cwd: "./e2e-skills",
    logLevel: "info",
  }),
  cacheDir: "./.stagehand-cache",
});

await stagehand.init();
const page = stagehand.context.pages()[0];
await page.goto("https://app.example.com/login");

// Semantic actions — no selectors needed
await stagehand.act("enter username test@example.com");
await stagehand.act("enter password password123");
await stagehand.act("click the login button");

await stagehand.close();
```

## Skill Configuration

Place a `CLAUDE.md` in your skill directory to guide selector generation:

```markdown
# E2E Testing Skill Context

## Selector Strategy
1. Prefer `data-testid` (e.g. `[data-testid="login-btn"]`)
2. Then `aria-label`
3. Then ARIA `role` + accessible name
4. Avoid hashed CSS classes

## Known Elements
- Login button: `[data-testid="login-btn"]` or `[aria-label="Sign in"]`
- Username input: `[data-testid="email-input"]` or `[name="email"]`
```

## Built-in Skills

The package ships reusable, general-purpose skills under [`skills/`](skills/) so you don't have to write skill docs from scratch:

| Skill | Purpose |
|-------|---------|
| [`selector-recognition`](skills/selector-recognition/CLAUDE.md) | Generate stable, generalizable, refactor-resistant CSS selectors for `act()` |
| [`e2e-authoring`](skills/e2e-authoring/CLAUDE.md) | Author high-quality, low-flake E2E tests (Playwright + Stagehand best practices) |

Point `cwd` at one, or copy it into your own skill dir and add your site's page structure:

```ts
createClaudeCodeLLMClient({
  cwd: "node_modules/@tengxiaohtx/stagehand-cc-agent/skills/selector-recognition",
});
```

See [`skills/README.md`](skills/README.md) for details.

## API Reference

### `createClaudeCodeLLMClient(options?)`

Creates a custom `LLMClient` for Stagehand.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `systemPromptEnhancement` | `string` | `""` | Extra instructions appended to Stagehand's system prompt |
| `agentType` | `"claude" \| "opencode" \| "qodercli"` | `"claude"` | Which agent CLI backs the LLM client |
| `agentArgs` | `string[]` | `[]` | Additional CLI arguments for the selected agent |
| `claudeArgs` | `string[]` | `[]` | **Deprecated** — use `agentArgs` |
| `cwd` | `string` | — | Working directory for the agent (used to discover `CLAUDE.md` skill files) |
| `logLevel` | `"debug" \| "info" \| "warn" \| "error"` | `"info"` | Log verbosity |
| `logTarget` | `"auto" \| "stdout" \| "file"` | `"auto"` | Log destination (auto-detects CI vs local) |
| `logFilePath` | `string` | `"./.stagehand-logs/llm-client.log"` | Log file path when `logTarget="file"` |
| `onSelfHeal` | `(event: SelfHealEvent) => void` | — | Callback for self-heal events |
| `enableSelectorGeneralization` | `boolean` | `true` | Inject/capture a generalized `cssSelector` on `act()` for stable caching |
| `timeout` | `number` | `60000` | Agent invocation timeout (ms) |
| `verbose` | `boolean` | `false` | Enable verbose agent output |

### `SelfHealTracker`

Tracks self-heal events and generates git commits.

```typescript
import { SelfHealTracker } from "@tengxiaohtx/stagehand-cc-agent";

const tracker = new SelfHealTracker({ cacheDir: "./.stagehand-cache" });
tracker.record(event);

const report = tracker.getReport();
const commitHash = await report.generateGitCommit("fix(e2e): self-heal selectors");
```

### `E2EReport`

Generates E2E test reports.

```typescript
import { E2EReport } from "@tengxiaohtx/stagehand-cc-agent";

const report = new E2EReport();
report.addTest(result);
report.printToStdout();
await report.writeToFile("./e2e-report.json");
```

## Examples

See the [examples/](examples/) directory:

| Example | Description |
|---------|-------------|
| [mdn-blog](examples/mdn-blog/) | Real-website E2E test — Stagehand launches the browser, Playwright attaches over CDP; extracts blog-card data from MDN and navigates to article details |
| [playwright-cdp](examples/playwright-cdp/) | Playwright launches Chrome (via `chrome-launcher`), then both Playwright and Stagehand attach to the same browser over CDP; uses the `qodercli` agent |

## CI Integration

```yaml
# .github/workflows/e2e.yml
name: E2E Tests
on: [push, pull_request]
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
        env:
          CI: true
```

CI runs use cached selectors exclusively — zero Claude Code calls, zero cost, millisecond-level execution.

## License

MIT
