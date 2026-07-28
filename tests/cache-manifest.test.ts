import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SelectorStore } from "../src/selector-store.js";
import { updateCacheManifest } from "../src/cache-manifest.js";
import type { CacheManifest } from "../src/types.js";

describe("updateCacheManifest", () => {
  let tempDir: string;
  let store: SelectorStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cache-manifest-test-"));
    store = new SelectorStore();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeCacheFile(filename: string, content: any) {
    writeFileSync(join(tempDir, filename), JSON.stringify(content, null, 2));
  }

  function readManifest(): CacheManifest {
    return JSON.parse(readFileSync(join(tempDir, "manifest.json"), "utf-8"));
  }

  describe("无 manifest 时初始化创建", () => {
    it("空目录 + 缓存文件 → 应生成 manifest.json", () => {
      writeCacheFile("abc123.json", {
        instruction: "click the login button",
        url: "https://example.com",
        actions: [{ selector: "button.login", method: "click" }],
      });

      const result = updateCacheManifest({
        cacheDir: tempDir,
        selectorStore: store,
      });

      expect(result.added).toBe(1);
      expect(result.totalEntries).toBe(1);

      const manifest = readManifest();
      expect(manifest.version).toBe(1);
      expect(manifest.entries["abc123"]).toBeDefined();
      expect(manifest.entries["abc123"].instruction).toBe("click the login button");
      expect(manifest.entries["abc123"].url).toBe("https://example.com");
      expect(manifest.entries["abc123"].selector).toBe("button.login");
      expect(manifest.entries["abc123"].status).toBe("active");
      expect(manifest.entries["abc123"].generalized).toBe(true);
    });
  });

  describe("全量运行标记 orphan", () => {
    it("提供权威 usedInstructions 且不含该指令 → status 变为 orphan", () => {
      // 先创建一个已有条目的 manifest
      writeCacheFile("abc123.json", {
        instruction: "click the login button",
        url: "https://example.com",
        actions: [{ selector: "button.login", method: "click" }],
      });

      const existingManifest: CacheManifest = {
        version: 1,
        updatedAt: new Date().toISOString(),
        ttlSeconds: 30 * 24 * 3600,
        entries: {
          abc123: {
            instruction: "click the login button",
            cacheFile: "abc123.json",
            selector: "button.login",
            url: "https://example.com",
            createdAt: new Date().toISOString(),
            lastUsed: new Date().toISOString(),
            status: "active",
            generalized: true,
          },
        },
      };
      writeFileSync(
        join(tempDir, "manifest.json"),
        JSON.stringify(existingManifest, null, 2)
      );

      // 权威 used 集合为空（本次运行未使用任何指令）→ 该条目应被标记为 orphan
      const result = updateCacheManifest({
        cacheDir: tempDir,
        selectorStore: store,
        isFullRun: true,
        usedInstructions: [],
      });

      expect(result.orphaned).toBe(1);

      const manifest = readManifest();
      expect(manifest.entries["abc123"].status).toBe("orphan");
    });
  });

  describe("缓存命中安全：不误标 orphan", () => {
    it("未提供 usedInstructions（模拟全量缓存命中）→ 不标记 orphan，保持 active", () => {
      // 场景：所有 act() 均缓存命中 → selectorStore.usedInstructions 为空。
      // 若仍据此标记 orphan，会把仍在使用的条目误删。此处验证安全降级。
      writeCacheFile("abc123.json", {
        instruction: "click the login button",
        url: "https://example.com",
        actions: [{ selector: "button.login", method: "click" }],
      });

      const now = new Date().toISOString();
      const existingManifest: CacheManifest = {
        version: 1,
        updatedAt: now,
        ttlSeconds: 30 * 24 * 3600,
        entries: {
          abc123: {
            instruction: "click the login button",
            cacheFile: "abc123.json",
            selector: "button.login",
            url: "https://example.com",
            createdAt: now,
            lastUsed: now,
            status: "active",
            generalized: true,
          },
        },
      };
      writeFileSync(
        join(tempDir, "manifest.json"),
        JSON.stringify(existingManifest, null, 2)
      );

      // isFullRun=true 但未提供权威 usedInstructions，store 也为空
      const result = updateCacheManifest({
        cacheDir: tempDir,
        selectorStore: store,
        isFullRun: true,
      });

      expect(result.orphaned).toBe(0);

      const manifest = readManifest();
      expect(manifest.entries["abc123"].status).toBe("active");
    });

    it("提供权威 usedInstructions 且包含该指令（模拟命中但已声明使用）→ 刷新，不孤儿", () => {
      writeCacheFile("abc123.json", {
        instruction: "click the login button",
        url: "https://example.com",
        actions: [{ selector: "button.login", method: "click" }],
      });

      const oldTime = "2024-01-01T00:00:00.000Z";
      const existingManifest: CacheManifest = {
        version: 1,
        updatedAt: oldTime,
        ttlSeconds: 30 * 24 * 3600,
        entries: {
          abc123: {
            instruction: "click the login button",
            cacheFile: "abc123.json",
            selector: "button.login",
            url: "https://example.com",
            createdAt: oldTime,
            lastUsed: oldTime,
            status: "active",
            generalized: true,
          },
        },
      };
      writeFileSync(
        join(tempDir, "manifest.json"),
        JSON.stringify(existingManifest, null, 2)
      );

      const beforeRun = Date.now();
      // store 为空（命中缓存），但调用方权威声明该指令被使用
      const result = updateCacheManifest({
        cacheDir: tempDir,
        selectorStore: store,
        isFullRun: true,
        usedInstructions: ["click the login button"],
      });

      expect(result.refreshed).toBe(1);
      expect(result.orphaned).toBe(0);

      const manifest = readManifest();
      expect(manifest.entries["abc123"].status).toBe("active");
      const lastUsedTime = new Date(manifest.entries["abc123"].lastUsed).getTime();
      expect(lastUsedTime).toBeGreaterThanOrEqual(beforeRun);
    });
  });

  describe("部分运行保留非涉及条目", () => {
    it("isFullRun=false 时未使用的条目保持原 status 不变", () => {
      writeCacheFile("abc123.json", {
        instruction: "click the login button",
        url: "https://example.com",
        actions: [{ selector: "button.login", method: "click" }],
      });

      const existingManifest: CacheManifest = {
        version: 1,
        updatedAt: new Date().toISOString(),
        ttlSeconds: 30 * 24 * 3600,
        entries: {
          abc123: {
            instruction: "click the login button",
            cacheFile: "abc123.json",
            selector: "button.login",
            url: "https://example.com",
            createdAt: new Date().toISOString(),
            lastUsed: new Date().toISOString(),
            status: "active",
            generalized: true,
          },
        },
      };
      writeFileSync(
        join(tempDir, "manifest.json"),
        JSON.stringify(existingManifest, null, 2)
      );

      // store 中没有标记为已使用，但 isFullRun=false
      const result = updateCacheManifest({
        cacheDir: tempDir,
        selectorStore: store,
        isFullRun: false,
      });

      expect(result.orphaned).toBe(0);

      const manifest = readManifest();
      expect(manifest.entries["abc123"].status).toBe("active");
    });
  });

  describe("TTL 过期检测", () => {
    it("lastUsed 时间超过 ttlSeconds → status 变为 expired", () => {
      writeCacheFile("abc123.json", {
        instruction: "click the login button",
        url: "https://example.com",
        actions: [{ selector: "button.login", method: "click" }],
      });

      // lastUsed 设为 60 天前
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString();
      const existingManifest: CacheManifest = {
        version: 1,
        updatedAt: sixtyDaysAgo,
        ttlSeconds: 30 * 24 * 3600,
        entries: {
          abc123: {
            instruction: "click the login button",
            cacheFile: "abc123.json",
            selector: "button.login",
            url: "https://example.com",
            createdAt: sixtyDaysAgo,
            lastUsed: sixtyDaysAgo,
            status: "active",
            generalized: true,
          },
        },
      };
      writeFileSync(
        join(tempDir, "manifest.json"),
        JSON.stringify(existingManifest, null, 2)
      );

      const result = updateCacheManifest({
        cacheDir: tempDir,
        selectorStore: store,
        ttlSeconds: 30 * 24 * 3600, // 30 天 TTL
      });

      expect(result.expired).toBe(1);

      const manifest = readManifest();
      expect(manifest.entries["abc123"].status).toBe("expired");
    });
  });

  describe("lastUsed 刷新逻辑", () => {
    it("使用中的条目 lastUsed 被更新为当前时间", () => {
      writeCacheFile("abc123.json", {
        instruction: "click the login button",
        url: "https://example.com",
        actions: [{ selector: "button.login", method: "click" }],
      });

      const oldTime = "2024-01-01T00:00:00.000Z";
      const existingManifest: CacheManifest = {
        version: 1,
        updatedAt: oldTime,
        ttlSeconds: 30 * 24 * 3600,
        entries: {
          abc123: {
            instruction: "click the login button",
            cacheFile: "abc123.json",
            selector: "button.login",
            url: "https://example.com",
            createdAt: oldTime,
            lastUsed: oldTime,
            status: "active",
            generalized: true,
          },
        },
      };
      writeFileSync(
        join(tempDir, "manifest.json"),
        JSON.stringify(existingManifest, null, 2)
      );

      // 标记为已使用
      store.markUsed("click the login button");

      const beforeRun = Date.now();
      const result = updateCacheManifest({
        cacheDir: tempDir,
        selectorStore: store,
      });

      expect(result.refreshed).toBe(1);

      const manifest = readManifest();
      const lastUsedTime = new Date(manifest.entries["abc123"].lastUsed).getTime();
      expect(lastUsedTime).toBeGreaterThanOrEqual(beforeRun);
      expect(manifest.entries["abc123"].status).toBe("active");
    });
  });

  describe("manifest.json 损坏时容错降级", () => {
    it("manifest 文件内容非法 JSON → 不抛错，重新初始化", () => {
      writeCacheFile("abc123.json", {
        instruction: "click the login button",
        url: "https://example.com",
        actions: [{ selector: "button.login", method: "click" }],
      });

      // 写入损坏的 manifest
      writeFileSync(join(tempDir, "manifest.json"), "{{not valid json!!!");

      // 不应抛错
      const result = updateCacheManifest({
        cacheDir: tempDir,
        selectorStore: store,
      });

      // 应该重新初始化并正常处理缓存文件
      expect(result.added).toBe(1);
      expect(result.totalEntries).toBe(1);

      const manifest = readManifest();
      expect(manifest.version).toBe(1);
      expect(manifest.entries["abc123"]).toBeDefined();
      expect(manifest.entries["abc123"].instruction).toBe("click the login button");
    });
  });
});
