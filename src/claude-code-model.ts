import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { Logger } from "./logger.js";
import type { ClaudeCodeResponse } from "./types.js";

/**
 * Resolve the absolute path of the `claude` CLI binary.
 * Falls back to the bare name if resolution fails.
 */
function resolveClaudeBin(): string {
  try {
    const result = execSync("command -v claude", { encoding: "utf8" }).trim();
    if (result) return result;
  } catch {
    // ignore
  }
  return "claude";
}

export class ClaudeCodeLanguageModel {
  constructor(
    private options: {
      systemPromptEnhancement?: string;
      claudeArgs?: string[];
      cwd?: string;
      timeout?: number;
      verbose?: boolean;
      logger: Logger;
    }
  ) {}

  async generate(
    systemPrompt: string | undefined,
    userPrompt: string,
    jsonSchema?: object
  ): Promise<ClaudeCodeResponse> {
    const startTime = Date.now();

    // 1. 构建 claude -p 命令
    const commandArgs = this.buildCommandArgs(systemPrompt, userPrompt, jsonSchema);

    this.options.logger.debug("Claude Code 命令", {
      command: `claude ${commandArgs.join(" ")}`,
    });

    // 2. 执行 claude -p
    const claudeResponse = await this.executeClaudeCommand(commandArgs);

    const durationMs = Date.now() - startTime;

    this.options.logger.info("Claude Code 调用完成", {
      durationMs,
      costUsd: claudeResponse.total_cost_usd,
      sessionId: claudeResponse.session_id,
    });

    return claudeResponse;
  }

  buildCommandArgs(
    systemPrompt: string | undefined,
    userPrompt: string,
    jsonSchema?: object
  ): string[] {
    const args = ["-p", userPrompt];

    // 追加 system prompt（Stagehand 的 + 增强 + JSON Schema 指令）
    let fullSystemPrompt = "";

    if (systemPrompt || this.options.systemPromptEnhancement) {
      fullSystemPrompt = [
        systemPrompt ?? "",
        this.options.systemPromptEnhancement ?? "",
      ]
        .filter(Boolean)
        .join("\n\n");
    }

    // 如果提供了 JSON Schema，添加到系统提示中强制结构化输出
    if (jsonSchema) {
      const schemaJson = JSON.stringify(jsonSchema, null, 2);
      const jsonInstruction = `\n\nIMPORTANT: You MUST return ONLY a valid JSON object (no markdown, no explanation, no additional text) that matches this schema:\n\`\`\`json\n${schemaJson}\n\`\`\`\n\nReturn the actual data, not the schema itself. Do not include any text before or after the JSON.`;

      fullSystemPrompt = fullSystemPrompt
        ? fullSystemPrompt + jsonInstruction
        : jsonInstruction;
    }

    if (fullSystemPrompt) {
      args.push("--append-system-prompt", fullSystemPrompt);
    }

    // 输出格式
    args.push("--output-format", "json");

    // 额外参数
    if (this.options.claudeArgs) {
      args.push(...this.options.claudeArgs);
    }

    return args;
  }

  /**
   * 解析 Claude Code 的输出
   * --output-format json 输出的是 JSON 数组，包含多个事件
   * 最后一个 type="result" 的事件包含最终结果
   */
  private parseClaudeOutput(stdout: string): ClaudeCodeResponse {
    const events = JSON.parse(stdout);

    // 如果是数组，找到最后的 result 事件
    if (Array.isArray(events)) {
      const resultEvent = [...events].reverse().find((e: any) => e.type === "result");

      if (resultEvent) {
        const resultText = resultEvent.result ?? "";

        // 尝试解析结构化输出（当使用 --json-schema 时）
        let structuredOutput: any;
        try {
          structuredOutput = JSON.parse(resultText);
          this.options.logger.debug("成功解析结构化输出", {
            keys: Object.keys(structuredOutput),
          });
        } catch {
          // 不是有效的 JSON，当作普通文本
          this.options.logger.debug("结果不是 JSON 格式，作为普通文本处理");
        }

        return {
          result: resultText,
          structured_output: structuredOutput,
          session_id: resultEvent.session_id ?? "",
          total_cost_usd: resultEvent.total_cost_usd ?? 0,
          cost_usd: resultEvent.usage ?? {},
        };
      }

      // 如果没有 result 事件，尝试从 assistant 消息中提取
      const assistantEvent = [...events]
        .reverse()
        .find((e: any) => e.type === "assistant" && e.message?.content);

      if (assistantEvent) {
        const content = assistantEvent.message.content;
        const text = Array.isArray(content)
          ? content
              .filter((c: any) => c.type === "text")
              .map((c: any) => c.text)
              .join("\n")
          : String(content);

        // 尝试解析结构化输出
        let structuredOutput: any;
        try {
          structuredOutput = JSON.parse(text);
        } catch {
          // 忽略
        }

        return {
          result: text,
          structured_output: structuredOutput,
          session_id: assistantEvent.session_id ?? "",
          total_cost_usd: 0,
          cost_usd: {},
        };
      }

      throw new Error("No result or assistant event found in Claude Code output");
    }

    // 如果是单个对象（兼容旧格式）
    return events as ClaudeCodeResponse;
  }

  private async executeClaudeCommand(
    args: string[]
  ): Promise<ClaudeCodeResponse> {
    return new Promise((resolve, reject) => {
      const claudeBin = resolveClaudeBin();

      // Validate cwd exists if provided
      let validCwd = this.options.cwd;
      if (validCwd) {
        const absoluteCwd = resolvePath(validCwd);
        if (!existsSync(absoluteCwd)) {
          this.options.logger.warn("cwd directory does not exist, using current directory", {
            requestedCwd: validCwd,
            absoluteCwd,
          });
          validCwd = undefined;
        }
      }

      this.options.logger.debug("Spawning claude process", {
        claudeBin,
        args: args.slice(0, 5),
        cwd: validCwd,
      });

      const proc = spawn(claudeBin, args, {
        timeout: this.options.timeout,
        cwd: validCwd,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          this.options.logger.error("Claude Code 执行失败", {
            exitCode: code,
            stderr: stderr.substring(0, 500),
            stdout: stdout.substring(0, 500),
          });
          reject(new Error(`claude -p exited with code ${code}: ${stderr || stdout}`));
          return;
        }

        try {
          const response = this.parseClaudeOutput(stdout);
          resolve(response);
        } catch (error) {
          this.options.logger.error("Claude Code 响应解析失败", {
            stdout: stdout.substring(0, 500),
            error: String(error),
          });
          reject(new Error(`Failed to parse Claude Code response: ${error}`));
        }
      });

      proc.on("error", (error) => {
        this.options.logger.error("Claude Code 启动失败", {
          error: String(error),
        });
        reject(new Error(`Failed to spawn claude process: ${error}`));
      });
    });
  }
}
