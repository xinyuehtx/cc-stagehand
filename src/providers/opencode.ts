/**
 * OpenCode Language Model Provider
 * 封装 opencode CLI 调用，实现 LanguageModelProvider 接口
 */
import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { ClaudeCodeResponse } from "../types.js";
import type { LanguageModelProvider, LanguageModelProviderOptions, AgentType } from "./types.js";

/**
 * Resolve the absolute path of the `opencode` CLI binary.
 * Falls back to the bare name if resolution fails.
 */
function resolveOpencodeBin(): string {
  try {
    const result = execSync("command -v opencode", { encoding: "utf8" }).trim();
    if (result) return result;
  } catch {
    // ignore
  }
  return "opencode";
}

export class OpencodeLanguageModel implements LanguageModelProvider {
  readonly type: AgentType = "opencode";

  constructor(private options: LanguageModelProviderOptions) {}

  async generate(
    systemPrompt: string | undefined,
    userPrompt: string,
    jsonSchema?: object
  ): Promise<ClaudeCodeResponse> {
    const startTime = Date.now();

    const commandArgs = this.buildCommandArgs(systemPrompt, userPrompt, jsonSchema);

    this.options.logger.debug("OpenCode 命令", {
      command: `opencode ${commandArgs.join(" ")}`,
    });

    const response = await this.executeCommand(commandArgs);

    const durationMs = Date.now() - startTime;

    this.options.logger.info("OpenCode 调用完成", {
      durationMs,
      costUsd: response.total_cost_usd,
      sessionId: response.session_id,
    });

    return response;
  }

  /**
   * 构建 opencode CLI 命令参数
   * TODO: 需要确认 opencode CLI 的实际参数格式，当前假设与 claude CLI 类似
   */
  buildCommandArgs(
    systemPrompt: string | undefined,
    userPrompt: string,
    jsonSchema?: object
  ): string[] {
    const args = ["-p", userPrompt];

    // 追加 system prompt
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
      // TODO: 确认 opencode 的 system prompt 参数名
      args.push("--append-system-prompt", fullSystemPrompt);
    }

    // 输出格式
    // TODO: 确认 opencode 的输出格式参数
    args.push("--output-format", "json");

    // 额外参数
    if (this.options.agentArgs) {
      args.push(...this.options.agentArgs);
    }

    return args;
  }

  /**
   * 解析 opencode 的输出
   * TODO: 确认 opencode 的输出格式，当前假设与 claude CLI 相同
   */
  private parseOutput(stdout: string): ClaudeCodeResponse {
    const events = JSON.parse(stdout);

    if (Array.isArray(events)) {
      const resultEvent = [...events].reverse().find((e: any) => e.type === "result");

      if (resultEvent) {
        const resultText = resultEvent.result ?? "";

        let structuredOutput: any;
        try {
          structuredOutput = JSON.parse(resultText);
          this.options.logger.debug("成功解析结构化输出", {
            keys: Object.keys(structuredOutput),
          });
        } catch {
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

      throw new Error("No result or assistant event found in opencode output");
    }

    return events as ClaudeCodeResponse;
  }

  private async executeCommand(args: string[]): Promise<ClaudeCodeResponse> {
    return new Promise((resolve, reject) => {
      const bin = resolveOpencodeBin();

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

      this.options.logger.debug("Spawning opencode process", {
        bin,
        args: args.slice(0, 5),
        cwd: validCwd,
      });

      const proc = spawn(bin, args, {
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
          this.options.logger.error("OpenCode 执行失败", {
            exitCode: code,
            stderr: stderr.substring(0, 500),
            stdout: stdout.substring(0, 500),
          });
          reject(new Error(`opencode -p exited with code ${code}: ${stderr || stdout}`));
          return;
        }

        try {
          const response = this.parseOutput(stdout);
          resolve(response);
        } catch (error) {
          this.options.logger.error("OpenCode 响应解析失败", {
            stdout: stdout.substring(0, 500),
            error: String(error),
          });
          reject(new Error(`Failed to parse opencode response: ${error}`));
        }
      });

      proc.on("error", (error) => {
        this.options.logger.error("OpenCode 启动失败", {
          error: String(error),
        });
        reject(new Error(`Failed to spawn opencode process: ${error}`));
      });
    });
  }
}
