import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { SelfHealEvent, SelfHealReport as SelfHealReportType } from "./types.js";

const execAsync = promisify(exec);

export class SelfHealTracker {
  private events: SelfHealEvent[] = [];
  private cacheDir: string;
  private gitBranch?: string;

  constructor(options?: {
    cacheDir?: string;
    gitBranch?: string;
  }) {
    this.cacheDir = options?.cacheDir ?? "./.stagehand-cache";
    this.gitBranch = options?.gitBranch;
  }

  /** 记录自愈事件 */
  record(event: SelfHealEvent): void {
    this.events.push(event);
  }

  /** 获取报告 */
  getReport(): SelfHealReportType {
    const totalCostUsd = this.events.reduce((sum, e) => sum + e.costUsd, 0);

    return {
      totalEvents: this.events.length,
      events: this.events,
      totalCostUsd,
      generateGitCommit: async (message?: string) => {
        return this.generateGitCommit(message);
      },
    };
  }

  /** 清空事件 */
  clear(): void {
    this.events = [];
  }

  /** 生成 git commit */
  private async generateGitCommit(message?: string): Promise<string | null> {
    if (this.events.length === 0) {
      return null;
    }

    try {
      // 切换到指定分支（如果有）
      if (this.gitBranch) {
        await execAsync(`git checkout -b ${this.gitBranch} 2>/dev/null || git checkout ${this.gitBranch}`);
      }

      // 添加缓存文件
      await execAsync(`git add ${this.cacheDir}`);

      // 生成 commit message
      const commitMessage = message ?? this.generateCommitMessage();

      // 创建 commit
      const { stdout } = await execAsync(`git commit -m "${commitMessage}"`);

      // 提取 commit hash
      const hashMatch = stdout.match(/\[.*\s+([a-f0-9]+)\]/);
      const commitHash = hashMatch ? hashMatch[1] : null;

      return commitHash;
    } catch (error) {
      console.error("Failed to generate git commit:", error);
      return null;
    }
  }

  /** 生成 commit message */
  private generateCommitMessage(): string {
    const lines = [
      `fix(e2e): self-heal ${this.events.length} selector(s)`,
      "",
    ];

    for (const event of this.events) {
      lines.push(`- ${event.instruction}`);
      lines.push(`  旧: ${event.oldSelector}`);
      lines.push(`  新: ${event.newSelector}`);
      lines.push(`  原因: ${event.reason}`);
      lines.push("");
    }

    lines.push(`总成本: $${this.events.reduce((sum, e) => sum + e.costUsd, 0).toFixed(4)}`);

    return lines.join("\n");
  }
}
