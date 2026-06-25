import { describe, it, expect, vi, beforeEach } from "vitest";
import { Stagehand } from "@browserbasehq/stagehand";
import { createClaudeCodeLLMClient } from "../src/llm-client.js";
import { spawn } from "node:child_process";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

describe("Integration: Stagehand + ClaudeCodeLLMClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const mockSpawn = vi.mocked(spawn);
    mockSpawn.mockReturnValue({
      stdout: {
        on: vi.fn((event, cb) => {
          if (event === "data") {
            cb(JSON.stringify({
              result: "Found login button",
              structured_output: {
                elementId: "0-9",
                method: "click",
                arguments: [],
              },
              session_id: "test-session",
              total_cost_usd: 0.003,
            }));
          }
        }),
      },
      stderr: { on: vi.fn() },
      on: vi.fn((event, cb) => {
        if (event === "close") cb(0);
      }),
    } as any);
  });

  it("应该成功创建 LLMClient 并调用 createChatCompletion", async () => {
    const client = createClaudeCodeLLMClient({
      systemPromptEnhancement: "优先使用 data-testid",
      cwd: "./e2e-skills",
      logTarget: "stdout",
    });

    const result = await client.createChatCompletion({
      options: {
        messages: [
          { role: "system", content: "You are a browser automation assistant" },
          { role: "user", content: "AX Tree: [...]\nInstruction: 点击登录按钮" },
        ],
      },
      logger: () => {},
    });

    // 验证返回的响应格式
    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("choices");
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0].message.role).toBe("assistant");
    expect(result.choices[0].message.content).toContain("elementId");
    expect(result).toHaveProperty("usage");

    // 验证 spawn 被调用
    expect(spawn).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["-p"]),
      expect.any(Object)
    );
  });

  it("应该正确处理没有 system message 的情况", async () => {
    const client = createClaudeCodeLLMClient({
      logTarget: "stdout",
    });

    const result = await client.createChatCompletion({
      options: {
        messages: [
          { role: "user", content: "点击登录按钮" },
        ],
      },
      logger: () => {},
    });

    expect(result.choices[0].message.content).toBeTruthy();
  });
});
