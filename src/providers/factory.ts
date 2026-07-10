import type { AgentType, LanguageModelProvider, LanguageModelProviderOptions } from "./types.js";
import { ClaudeCodeLanguageModel } from "../claude-code-model.js";
import { OpencodeLanguageModel } from "./opencode.js";
import { QodercliLanguageModel } from "./qodercli.js";

/**
 * 根据 Agent 类型创建对应的 Language Model Provider
 */
export function createLanguageModelProvider(
  type: AgentType,
  options: LanguageModelProviderOptions
): LanguageModelProvider {
  switch (type) {
    case "claude":
      return new ClaudeCodeLanguageModel(options);
    case "opencode":
      return new OpencodeLanguageModel(options);
    case "qodercli":
      return new QodercliLanguageModel(options);
    default:
      throw new Error(`Unsupported agent type: ${type}`);
  }
}
