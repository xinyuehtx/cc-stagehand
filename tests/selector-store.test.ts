import { describe, it, expect, beforeEach } from "vitest";
import { SelectorStore } from "../src/selector-store.js";

describe("SelectorStore", () => {
  let store: SelectorStore;

  beforeEach(() => {
    store = new SelectorStore();
  });

  it("set/get 基本读写", () => {
    store.set("指令A", "article a");
    expect(store.get("指令A")).toBe("article a");
  });

  it("get 不存在的 key 返回 undefined", () => {
    expect(store.get("不存在")).toBeUndefined();
  });

  it("has 存在的 key 返回 true", () => {
    store.set("指令A", "article a");
    expect(store.has("指令A")).toBe(true);
  });

  it("has 不存在的 key 返回 false", () => {
    expect(store.has("指令A")).toBe(false);
  });

  it("size 返回条目数", () => {
    store.set("a", "1");
    store.set("b", "2");
    store.set("c", "3");
    expect(store.size).toBe(3);
  });

  it("clear 清空所有记录", () => {
    store.set("a", "1");
    store.set("b", "2");
    store.clear();
    expect(store.size).toBe(0);
  });

  it("相同 key 覆盖旧值", () => {
    store.set("指令A", "old");
    store.set("指令A", "new");
    expect(store.get("指令A")).toBe("new");
    expect(store.size).toBe(1);
  });

  it("entries 返回所有映射", () => {
    store.set("a", "1");
    store.set("b", "2");
    const entries = [...store.entries()];
    expect(entries).toEqual([
      ["a", "1"],
      ["b", "2"],
    ]);
  });
});
