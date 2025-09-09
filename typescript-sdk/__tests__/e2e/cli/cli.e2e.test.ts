// @vitest-environment node
// @vitest-config ./vitest.e2e.config.mts

/**
 * CLI E2E tests
 *
 * TODO: To run against the actual server locally, set CI=false
 */

import { describe, expect, it, beforeAll, afterEach, beforeEach } from "vitest";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import { config } from "dotenv";
import { CliHelpers } from "./helpers/cli-helpers";

config({ path: ".env.test" });

describe("CLI Sync E2E", () => {
  let testDir: string;
  let originalCwd: string;
  let helpers: CliHelpers;

  beforeEach(() => {
    const tmpBaseDir = path.join(__dirname, "tmp");
    fs.mkdirSync(tmpBaseDir, { recursive: true });
    testDir = fs.mkdtempSync(path.join(tmpBaseDir, "langwatch-sync-"));
    helpers = new CliHelpers({ testDir });
    originalCwd = process.cwd();
    process.chdir(testDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    // fs.rmSync(testDir, { recursive: true, force: true });
  });

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
    console.log(sync1.output);
    expect(sync1.success).toBe(true);
    console.log(sync1.output);
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

  it("should handle mixed remote and local prompts", async () => {
    // Initialize
    helpers.runCli("prompt init");

    // Add remote prompt
    helpers.runCli("prompt add remote-prompt");

    // Create local prompt
    helpers.createPromptFile("local-prompt", {
      model: "gpt-3.5-turbo",
      temperature: 0.5,
    });

    // Create config with both
    helpers.createConfig({
      "remote-prompt": "latest",
      "local-prompt": "file:prompts/local-prompt.prompt.yaml",
    });

    // Sync both
    const sync = helpers.runCli("prompt sync");
    expect(sync.success).toBe(true);
    expect(sync.output).toContain("Pulled remote-prompt");
    expect(sync.output).toContain("Created local-prompt");

    // Verify both in lock
    const lock = helpers.loadLock();
    expect(lock.prompts["remote-prompt"]).toBeDefined();
    expect(lock.prompts["local-prompt"]).toBeDefined();
  });
});
