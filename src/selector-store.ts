/**
 * SelectorStore — 内存级的 instruction → cssSelector 映射存储。
 *
 * 在 act() 调用期间自动收集 LLM 返回的 cssSelector，
 * 供测试结束后的缓存后处理使用。
 */
export class SelectorStore {
  private store: Map<string, string> = new Map();

  /** 存储 instruction 对应的 cssSelector */
  set(instruction: string, cssSelector: string): void {
    this.store.set(instruction, cssSelector);
  }

  /** 获取 instruction 对应的 cssSelector */
  get(instruction: string): string | undefined {
    return this.store.get(instruction);
  }

  /** 检查是否存在某 instruction 的记录 */
  has(instruction: string): boolean {
    return this.store.has(instruction);
  }

  /** 返回所有映射条目 */
  entries(): IterableIterator<[string, string]> {
    return this.store.entries();
  }

  /** 当前存储条目数 */
  get size(): number {
    return this.store.size;
  }

  /** 清空所有记录 */
  clear(): void {
    this.store.clear();
  }
}
