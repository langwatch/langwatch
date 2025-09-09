// @vitest-environment node
// @vitest-config ./vitest.e2e.config.mts

/**
 * CLI E2E tests
 *
 * TODO: To run against the actual server locally, set CI=false
 */

import { describe, expect, it, beforeAll, afterEach, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

import { config } from "dotenv";
import { CliHelpers } from "./helpers/cli-helpers";

config({ path: ".env.test", override: true });

describe("CLI E2E", () => {
  let testDir: string;
  let originalCwd: string;
  let helpers: CliHelpers;

  beforeEach(() => {
    const tmpBaseDir = path.join(__dirname, "tmp");
    fs.mkdirSync(tmpBaseDir, { recursive: true });
    testDir = fs.mkdtempSync(path.join(tmpBaseDir, "langwatch-sync-"));
    console.log("testDir", testDir);
    helpers = new CliHelpers({ testDir });
    originalCwd = process.cwd();
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    // fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe("Sync", () => {
    it.only("should sync local prompt through complete workflow", async () => {
      const { runCli, createPromptFile, createConfig } = helpers;

      // 1. Initialize project
      const init = runCli("prompt init");
      expect(init.success).toBe(true);

      const promptName = helpers.createUniquePromptName();

      // 2. Create local prompt
      createPromptFile(promptName, {
        model: "gpt-4",
        temperature: 0.8,
        systemMessage: "You are a coding assistant.",
        userMessage: "Help me with {{task}}",
      });

      // 3. Add to config
      createConfig({
        [promptName]: `file:prompts/${promptName}.prompt.yaml`,
      });

      // 4. First sync - should create
      const sync1 = runCli("prompt sync");
      expect(sync1.success).toBe(true);
      expect(sync1.output).toContain(`Pushed ${promptName}`);

      // 5. Verify lock file
      const lock1 = helpers.loadLock();
      expect(lock1.prompts[promptName]).toBeDefined();
      expect(lock1.prompts[promptName].version).toBe(0);

      // 6. Modify local file
      helpers.updatePromptFile(promptName, {
        model: "gpt-4-turbo",
        temperature: 0.9,
        systemMessage: "You are an expert coding assistant.",
      });

      // 7. Second sync - should update
      const sync2 = runCli("prompt sync");
      expect(sync2.success).toBe(true);
      expect(sync2.output).toContain(`Pushed ${promptName}`);

      // 8. Verify version increment
      const lock2 = helpers.loadLock();
      expect(lock2.prompts[promptName].version).toBe(1);

      // 9. Third sync - should be up-to-date
      const sync3 = runCli("prompt sync");
      expect(sync3.success).toBe(true);
      expect(sync3.output).toContain("no changes");
    });
  });
});
