import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import { PromptsManifest } from "../prompts-manifest";

describe("PromptsManifest", () => {
  const testManifestPath = "test-prompts.json";

  beforeEach(() => {
    // Clean up any existing test file
    if (fs.existsSync(testManifestPath)) {
      fs.unlinkSync(testManifestPath);
    }
  });

  afterEach(() => {
    // Clean up test file
    if (fs.existsSync(testManifestPath)) {
      fs.unlinkSync(testManifestPath);
    }
  });

  describe("getPath", () => {
    it("throws error when prompts.json does not exist", () => {
      expect(() => PromptsManifest.getPath("any-handle")).toThrow("prompts.json not found");
    });

    it("throws error for non-existent handle", () => {
      // Create empty manifest
      const manifest = { prompts: {} };
      fs.writeFileSync(testManifestPath, JSON.stringify(manifest, null, 2));

      // Temporarily override the manifest path for testing
      const originalPath = PromptsManifest.MANIFEST_FILE;
      PromptsManifest.MANIFEST_FILE = testManifestPath;

      expect(() => PromptsManifest.getPath("non-existent")).toThrow("Prompt handle 'non-existent' not found in prompts.json");

      // Restore original path
      PromptsManifest.MANIFEST_FILE = originalPath;
    });

    it("returns materialized path for remote dependency from lock file", () => {
      // Create test manifest with remote dependency
      const manifest = {
        prompts: {
          "remote-prompt": "latest"
        }
      };
      fs.writeFileSync(testManifestPath, JSON.stringify(manifest, null, 2));

      // Create test lock file with materialized path
      const testLockPath = "test-prompts-lock.json";
      const lockFile = {
        lockfileVersion: 1,
        prompts: {
          "remote-prompt": {
            version: 5,
            versionId: "version_123",
            materialized: "prompts/.materialized/remote-prompt.prompt.yaml"
          }
        }
      };
      fs.writeFileSync(testLockPath, JSON.stringify(lockFile, null, 2));

      // Temporarily override the paths for testing
      const originalManifestPath = PromptsManifest.MANIFEST_FILE;
      const originalLockPath = PromptsManifest.LOCK_FILE;
      PromptsManifest.MANIFEST_FILE = testManifestPath;
      PromptsManifest.LOCK_FILE = testLockPath;

      const result = PromptsManifest.getPath("remote-prompt");
      expect(result).toBe("prompts/.materialized/remote-prompt.prompt.yaml");

      // Restore original paths
      PromptsManifest.MANIFEST_FILE = originalManifestPath;
      PromptsManifest.LOCK_FILE = originalLockPath;

      // Clean up test lock file
      if (fs.existsSync(testLockPath)) {
        fs.unlinkSync(testLockPath);
      }
    });

    it("returns file path for local file dependency", () => {
      // Create test manifest with local file dependency
      const manifest = {
        prompts: {
          "local-prompt": "file:prompts/local-prompt.prompt.yaml"
        }
      };
      fs.writeFileSync(testManifestPath, JSON.stringify(manifest, null, 2));

      // Temporarily override the manifest path for testing
      const originalPath = PromptsManifest.MANIFEST_FILE;
      PromptsManifest.MANIFEST_FILE = testManifestPath;

      const result = PromptsManifest.getPath("local-prompt");
      expect(result).toBe("prompts/local-prompt.prompt.yaml");

      // Restore original path
      PromptsManifest.MANIFEST_FILE = originalPath;
    });
  });
});
