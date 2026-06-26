import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SelectorStore } from "../src/selector-store.js";
import { generalizeCacheSelectors } from "../src/cache-updater.js";

describe("generalizeCacheSelectors", () => {
  let tempDir: string;
  let store: SelectorStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cache-updater-test-"));
    store = new SelectorStore();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeCacheFile(filename: string, content: any) {
    writeFileSync(join(tempDir, filename), JSON.stringify(content, null, 2));
  }

  function readCacheFile(filename: string) {
    return JSON.parse(readFileSync(join(tempDir, filename), "utf-8"));
  }

  it("正常替换 xpath 选择器", () => {
    writeCacheFile("test.json", {
      version: 1,
      instruction: "点击按钮",
      actions: [{ selector: "xpath=/html[1]/body[1]/div[1]/a[1]", method: "click", arguments: [] }],
    });
    store.set("点击按钮", "article:first-of-type footer a");

    const result = generalizeCacheSelectors({ cacheDir: tempDir, selectorStore: store });

    expect(result.updatedSelectors).toBe(1);
    expect(result.details[0].oldSelector).toBe("xpath=/html[1]/body[1]/div[1]/a[1]");
    expect(result.details[0].newSelector).toBe("article:first-of-type footer a");

    const updated = readCacheFile("test.json");
    expect(updated.actions[0].selector).toBe("article:first-of-type footer a");
  });

  it("无对应 store 记录时保留原始 xpath", () => {
    writeCacheFile("test.json", {
      version: 1,
      instruction: "点击按钮",
      actions: [{ selector: "xpath=/html[1]/body[1]/a[1]", method: "click", arguments: [] }],
    });
    // store 为空

    const result = generalizeCacheSelectors({ cacheDir: tempDir, selectorStore: store });

    expect(result.skippedSelectors).toBe(1);
    expect(result.updatedSelectors).toBe(0);

    const unchanged = readCacheFile("test.json");
    expect(unchanged.actions[0].selector).toBe("xpath=/html[1]/body[1]/a[1]");
  });

  it("非 xpath 选择器不处理", () => {
    writeCacheFile("test.json", {
      version: 1,
      instruction: "点击按钮",
      actions: [{ selector: "article a", method: "click", arguments: [] }],
    });
    store.set("点击按钮", "new-selector");

    const result = generalizeCacheSelectors({ cacheDir: tempDir, selectorStore: store });

    expect(result.updatedSelectors).toBe(0);
    expect(result.skippedSelectors).toBe(0);

    const unchanged = readCacheFile("test.json");
    expect(unchanged.actions[0].selector).toBe("article a");
  });

  it("空缓存目录", () => {
    const result = generalizeCacheSelectors({ cacheDir: tempDir, selectorStore: store });
    expect(result.totalFiles).toBe(0);
    expect(result.updatedSelectors).toBe(0);
  });

  it("多 actions 条目都被替换", () => {
    writeCacheFile("test.json", {
      version: 1,
      instruction: "点击按钮",
      actions: [
        { selector: "xpath=/html[1]/body[1]/a[1]", method: "click", arguments: [] },
        { selector: "xpath=/html[1]/body[1]/input[1]", method: "fill", arguments: ["hello"] },
      ],
    });
    store.set("点击按钮", "button.submit");

    const result = generalizeCacheSelectors({ cacheDir: tempDir, selectorStore: store });

    expect(result.updatedSelectors).toBe(2);
    const updated = readCacheFile("test.json");
    expect(updated.actions[0].selector).toBe("button.submit");
    expect(updated.actions[1].selector).toBe("button.submit");
  });

  it("缓存文件 JSON 解析失败时跳过", () => {
    writeFileSync(join(tempDir, "bad.json"), "not valid json{{{");
    store.set("something", "article a");

    const result = generalizeCacheSelectors({ cacheDir: tempDir, selectorStore: store });

    expect(result.totalFiles).toBe(1);
    expect(result.updatedSelectors).toBe(0);
  });

  it("缓存目录不存在时返回空结果", () => {
    const result = generalizeCacheSelectors({
      cacheDir: "/nonexistent/path",
      selectorStore: store,
    });
    expect(result.totalFiles).toBe(0);
  });
});
