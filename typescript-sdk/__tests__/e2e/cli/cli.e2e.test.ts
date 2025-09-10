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
import { getLangwatchSDK } from "../../helpers/get-sdk";
import { LangWatch } from "../../../dist";

config({ path: ".env.test", override: true });

describe("CLI E2E", () => {
  let testDir: string;
  let originalCwd: string;
  let helpers: CliHelpers;
  let langwatch: LangWatch;

  beforeEach(() => {
    langwatch = new LangWatch();
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

  describe("sync", () => {
    describe("complete workflow: create prompt, update prompt, sync prompt", () => {
      it("should sync local prompt through complete workflow", async () => {
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
        expect(helpers.getPromptFileContent(promptName)).toMatchInlineSnapshot(`
        "model: gpt-4
        modelParameters:
          temperature: 0.8
        messages:
          - role: system
            content: You are a coding assistant.
          - role: user
            content: Help me with {{task}}
        "
      `);

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
        expect(helpers.getPromptFileContent(promptName)).toMatchInlineSnapshot(`
        "model: gpt-4-turbo
        modelParameters:
          temperature: 0.9
        messages:
          - role: system
            content: You are an expert coding assistant.
          - role: user
            content: Help me with {{task}}
        "
      `);

        // 8. Verify version increment
        const lock2 = helpers.loadLock();
        expect(lock2.prompts[promptName].version).toBe(1);

        // 9. Third sync - should be up-to-date
        const sync3 = runCli("prompt sync");
        expect(sync3.success).toBe(true);
        expect(sync3.output).toContain("no changes");
      });
    });

    describe("when there are changes on the remote prompt", () => {
      describe("when user chooses to use remote version", () => {
        it("should sync the local prompt", async () => {
          const { runCli, runCliInteractive, createPromptFile, createConfig } =
            helpers;

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
          expect(helpers.getPromptFileContent(promptName))
            .toMatchInlineSnapshot(`
            "model: gpt-4
            modelParameters:
              temperature: 0.8
            messages:
              - role: system
                content: You are a coding assistant.
              - role: user
                content: Help me with {{task}}
            "
          `);

          // 5. Modify remote prompt
          await langwatch.prompts.update(promptName, {
            temperature: 0.9,
            model: "gpt-4-turbo",
            messages: [
              {
                role: "system",
                content: "You an updated system message.",
              },
              {
                role: "user",
                content: "Do you like apples?",
              },
            ],
          });

          // 6. Second sync - should sync
          const sync2 = await runCliInteractive("prompt sync", ["r"]);
          expect(sync2.output).toContain(`Conflict`);
          expect(sync2.output).toMatchInlineSnapshot(`
            "🔄 Starting sync...

            ⚠ Conflict detected for prompt: test-prompt-1757488389666
            Local version: 0, Remote version: 1

            Differences:
              • model: gpt-4 → gpt-4-turbo
              • prompt content differs
              • messages differ
              • temperature: 0.8 → 0.9

            Options:
              [l] Use local version (overwrite remote)
              [r] Use remote version (overwrite local)
              [a] Abort sync for this prompt
            Choose resolution (l/r/a): ✓ Pulled test-prompt-1757488389666@latest (version 1) → ./prompts/test-prompt-1757488389666.prompt.yaml
            Synced 1 fetched in 0.3s
            - Pushing 1 local prompts...
            - Pushing 1 local prompts...
            "
          `);
          expect(helpers.getPromptFileContent(promptName))
            .toMatchInlineSnapshot(`
            "model: gpt-4-turbo
            modelParameters:
              temperature: 0.9
            messages:
              - role: system
                content: You an updated system message.
              - role: user
                content: Do you like apples?
            "
          `);
        });
      });

      describe("when user chooses to use local version", () => {
        it.todo("should replace the remote version with the local version");
      });
    });
  });

  describe("list", () => {
    it("should be able to list remote prompts", async () => {
      const handle = "remote-prompt-" + Date.now();
      // Create a remote prompt
      let prompt = await langwatch.prompts.create({
        handle,
        commitMessage: "Created via E2E test",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant.",
          },
        ],
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        model: "gpt-4-turbo",
        temperature: 0.2,
        maxTokens: 100,
      });

      expect(prompt.handle).toEqual(handle);
      expect(prompt.temperature).toEqual(0.2);

      // Update the prompt so it's not a draft. Drafts will not appear in the list.
      const updatedPrompt = await langwatch.prompts.update(prompt.id, {
        commitMessage: "Updated via E2E test",
        temperature: 0.3,
      });

      expect(updatedPrompt.temperature).toEqual(0.3);

      const { runCli } = helpers;

      // 1. Initialize project
      const init = runCli("prompt list");
      expect(init.success).toBe(true);
      expect(init.output).toContain(prompt.handle);
    });
  });
});
