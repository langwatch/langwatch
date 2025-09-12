import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import { PromptsLock } from "../prompts-lock";
import { MissingPromptLockError, PromptNotFoundError } from "../errors";

describe("PromptsLock", () => {
  const testLockPath = "test-prompts-lock.json";
  let lock: PromptsLock;

  beforeEach(() => {
    // Clean up any existing test file
    if (fs.existsSync(testLockPath)) {
      fs.unlinkSync(testLockPath);
    }
    lock = new PromptsLock({ lockFile: testLockPath });
  });

  afterEach(() => {
    // Clean up test file
    if (fs.existsSync(testLockPath)) {
      fs.unlinkSync(testLockPath);
    }
  });

  describe("init", () => {
    it("creates empty lock file if it doesn't exist", () => {
      lock.init();

      expect(fs.existsSync(testLockPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(testLockPath, "utf-8"));
      expect(content).toEqual({
        lockfileVersion: 1,
        prompts: {}
      });
    });

    it("preserves existing content when run on existing lock file", () => {
      // Create existing lock file
      const existingContent = {
        lockfileVersion: 1,
        prompts: {
          "existing-prompt": {
            version: 1,
            versionId: "v1",
            materialized: "some/path.yaml"
          }
        }
      };
      fs.writeFileSync(testLockPath, JSON.stringify(existingContent, null, 2));

      lock.init();

      const content = JSON.parse(fs.readFileSync(testLockPath, "utf-8"));
      expect(content).toEqual(existingContent);
    });
  });

  describe("updateEntry", () => {
    it("creates lock file and adds entry if file doesn't exist", () => {
      lock.updateEntry("new-prompt", {
        version: 3,
        versionId: "v3_abc",
        materialized: "prompts/.materialized/new-prompt.prompt.yaml"
      });

      expect(fs.existsSync(testLockPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(testLockPath, "utf-8"));
      expect(content).toEqual({
        lockfileVersion: 1,
        prompts: {
          "new-prompt": {
            version: 3,
            versionId: "v3_abc",
            materialized: "prompts/.materialized/new-prompt.prompt.yaml"
          }
        }
      });
    });

    it("updates existing entry in existing lock file", () => {
      lock.init();
      lock.updateEntry("existing-prompt", {
        version: 1,
        versionId: "v1",
        materialized: "old/path.yaml"
      });

      // Update the entry
      lock.updateEntry("existing-prompt", {
        version: 2,
        versionId: "v2_updated",
        materialized: "new/path.yaml"
      });

      const content = JSON.parse(fs.readFileSync(testLockPath, "utf-8"));
      expect(content.prompts["existing-prompt"]).toEqual({
        version: 2,
        versionId: "v2_updated",
        materialized: "new/path.yaml"
      });
    });
  });

  describe("getMaterializedPath", () => {
    it("throws MissingPromptLockError when prompts-lock.json does not exist", () => {
      const defaultLock = new PromptsLock({ lockFile: testLockPath }); // uses default path
      expect(() => defaultLock.getMaterializedPath("any-handle")).toThrow(MissingPromptLockError);
    });

    it("throws PromptNotFoundError for non-existent handle", () => {
      lock.init(); // Create empty lock file

      expect(() => lock.getMaterializedPath("non-existent")).toThrow(PromptNotFoundError);
    });

    it("returns materialized path for existing handle", () => {
      lock.init();
      lock.updateEntry("my-prompt", {
        version: 5,
        versionId: "version_123",
        materialized: "prompts/.materialized/my-prompt.prompt.yaml"
      });

      const result = lock.getMaterializedPath("my-prompt");
      expect(result).toBe("prompts/.materialized/my-prompt.prompt.yaml");
    });
  });
});
