// @vitest-environment node
// @vitest-config ./vitest.e2e.config.mts

/**
 * CLI E2E tests
 *
 * TODO: To run against the actual server locally, set CI=false
 */

import { describe, expect, it, afterEach, beforeEach, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";

import { config } from "dotenv";
import {
  expectations,
  CliRunner,
  LockFileManager,
  PROMPT_NAME_PREFIX,
  PromptFileManager,
} from "./helpers";
import { LangWatch } from "../../../dist";
import { ApiHelpers } from "./helpers/api-helpers";

config({ path: ".env.test", override: true });

const { expectCliResultSuccess } = expectations;
const TMP_BASE_DIR = path.join(__dirname, "tmp");

const createUniquePromptName = () => {
  return `${PROMPT_NAME_PREFIX}-${Date.now()}`;
};

describe("CLI E2E", () => {
  let testDir: string;
  let originalCwd: string;
  let langwatch: LangWatch;
  let localPromptFileManagement: PromptFileManager;
  let materializedPromptFileManagement: PromptFileManager;
  let lockFileManager: LockFileManager;
  let cli: CliRunner;

  beforeEach(() => {
    langwatch = new LangWatch();
    fs.mkdirSync(TMP_BASE_DIR, { recursive: true });
    testDir = fs.mkdtempSync(path.join(TMP_BASE_DIR, "langwatch-sync-"));
    console.log("testDir", testDir);
    originalCwd = process.cwd();
    process.chdir(testDir);
    cli = new CliRunner({ cwd: testDir });
    localPromptFileManagement = new PromptFileManager({ cwd: testDir });
    materializedPromptFileManagement = new PromptFileManager({
      cwd: testDir,
      materializedDir: true,
    });
    lockFileManager = new LockFileManager({ cwd: testDir });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
  });

  afterAll(async () => {
    // Clean up test prompts
    const apiHelpers = new ApiHelpers(langwatch);
    await apiHelpers.cleapUpTestPrompts();
  });

  describe("sync", () => {
    describe("create local -> sync -> update local -> sync", () => {
      it("should keep remote prompt up to date", async () => {
        // Initialize project
        const initResult = cli.run("prompt init");
        expectCliResultSuccess(initResult);

        const promptHandle = createUniquePromptName();

        // Create local prompt
        const createResult = cli.run(`prompt create ${promptHandle}`);
        expectCliResultSuccess(createResult);

        // Verify prompt file content
        expect(localPromptFileManagement.getPromptFileContent(promptHandle))
          .toMatchInlineSnapshot(`
          "model: openai/gpt-5
          modelParameters:
            temperature: 0.7
          messages:
            - role: system
              content: You are a helpful assistant.
            - role: user
              content: "{{input}}"
          "
        `);

        // Add to config
        const filePath =
          localPromptFileManagement.getPromptFilePath(promptHandle);
        cli.run(`prompt add ${promptHandle} ${filePath}`);

        // First sync - should create on remote
        const sync1 = cli.run("prompt sync");
        expectCliResultSuccess(sync1);
        expect(sync1.output).toContain(`Pushed ${promptHandle}`);

        // Verify remote prompt
        const remotePrompt = await langwatch.prompts.get(promptHandle);
        expect(remotePrompt.model).toBe("openai/gpt-5");
        expect(remotePrompt.temperature).toBe(0.7);
        expect(remotePrompt.messages).toEqual([
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "{{input}}" },
        ]);

        // Verify lock file
        const lock1 = lockFileManager.readLockFile();
        expect(lock1.prompts[promptHandle]).toBeDefined();
        expect(lock1.prompts[promptHandle].version).toBe(0);

        // Modify local file
        localPromptFileManagement.updatePromptFile(promptHandle, {
          model: "gpt-4-turbo",
          modelParameters: { temperature: 0.9 },
          messages: [
            { role: "system", content: "You are an updated system message." },
            { role: "user", content: "You are an updated user message." },
          ],
        });
        expect(localPromptFileManagement.getPromptFileContent(promptHandle))
          .toMatchInlineSnapshot(`
        "model: gpt-4-turbo
        modelParameters:
          temperature: 0.9
        messages:
          - role: system
            content: You are an updated system message.
          - role: user
            content: You are an updated user message.
        "
      `);

        // Second sync - should update on remote
        const sync2 = cli.run("prompt sync");
        expectCliResultSuccess(sync2);

        // Verify remote prompt
        const updatedRemotePrompt = await langwatch.prompts.get(promptHandle);
        expect(updatedRemotePrompt.model).toBe("gpt-4-turbo");
        expect(updatedRemotePrompt.temperature).toBe(0.9);
        expect(updatedRemotePrompt.messages).toEqual([
          { role: "system", content: "You are an updated system message." },
          { role: "user", content: "You are an updated user message." },
        ]);

        // Verify version incremented
        const lock2 = lockFileManager.readLockFile();
        expect(lock2.prompts[promptHandle].version).toBe(1);

        // Third sync - should be up-to-date
        const sync3 = cli.run("prompt sync");
        expectCliResultSuccess(sync3);
        expect(sync3.output).toContain("no changes");
      });
    });

    describe("when there are changes on the remote prompt", () => {
      let promptHandle: string;

      beforeEach(async () => {
        // Initialize project
        const init = cli.run("prompt init");
        expectCliResultSuccess(init);

        // Create local prompt
        promptHandle = createUniquePromptName();
        const createResult = cli.run(`prompt create ${promptHandle}`);
        expectCliResultSuccess(createResult);
        const filePath =
          localPromptFileManagement.getPromptFilePath(promptHandle);
        const addResult = cli.run(`prompt add ${promptHandle} ${filePath}`);
        expectCliResultSuccess(addResult);

        // First sync - should create on remote
        const sync1 = cli.run("prompt sync");
        expectCliResultSuccess(sync1);
        const localPrompt =
          localPromptFileManagement.readPromptFile(promptHandle);

        // Verify remote prompt
        const remotePrompt = await langwatch.prompts.get(promptHandle);
        expect(remotePrompt.handle).toBe(promptHandle);
        expect(remotePrompt.model).toBe(localPrompt.model);
        expect(remotePrompt.temperature).toBe(
          localPrompt.modelParameters.temperature,
        );
        expect(remotePrompt.messages).toEqual(localPrompt.messages);

        // 5. Modify remote prompt
        await langwatch.prompts.update(promptHandle, {
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
      });

      describe("when user chooses to use remote version", () => {
        it("should replace the local prompt with the remote version", async () => {
          // Second sync - should sync
          const sync2 = await cli.runInteractive("prompt sync", ["r"]);

          // Verify conflict output
          expect(sync2.output).toContain(`Conflict`);
          expect(sync2.output).toContain(`Differences:`);
          expect(sync2.output).toContain(`• model: openai/gpt-5 → gpt-4-turbo`);
          expect(sync2.output).toContain(`• prompt content differs`);
          expect(sync2.output).toContain(`• messages differ`);
          expect(sync2.output).toContain(`• temperature: 0.7 → 0.9`);

          expect(localPromptFileManagement.getPromptFileContent(promptHandle))
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
        it("should replace the remote version with the local version", async () => {
          // Run sync and choose local version ('l')
          const sync = await cli.runInteractive(`prompt sync`, ["l"]);
          expectCliResultSuccess(sync);

          // Remote should now match local
          const updatedRemote = await langwatch.prompts.get(promptHandle);
          expect(updatedRemote.model).toBe("gpt-4-turbo");
          expect(updatedRemote.temperature).toBe(0.9);
          expect(updatedRemote.prompt).toBe("You an updated system message.");
          expect(updatedRemote.messages).toEqual([
            { role: "system", content: "You an updated system message." },
            { role: "user", content: "Do you like apples?" },
          ]);
        });
      });
    });

    // Using latest is a special case. It should always pull down and never push up to remote
    describe("@latest sync", () => {
      let promptHandle: string;

      beforeEach(async () => {
        promptHandle = createUniquePromptName();
        await langwatch.prompts.create({
          handle: promptHandle,
          model: "gpt-4-turbo",
          temperature: 0.9,
          prompt: "You are a helpful assistant.",
        });

        // Update to change from draft
        const addResult = await cli.runInteractive(
          `prompt add ${promptHandle}@latest`,
          ["y"],
        );

        expectCliResultSuccess(addResult);

        const sync = cli.run("prompt sync");
        expectCliResultSuccess(sync);
      });

      it("should pull down the latest version from remote into materialized", async () => {
        expect(
          materializedPromptFileManagement.getPromptFileContent(promptHandle),
        ).toMatchInlineSnapshot(`
          "model: gpt-4-turbo
          messages:
            - role: system
              content: You are a helpful assistant.
          modelParameters:
            temperature: 0.9
          "
        `);
      });

      it("should not be in the prompts directory", () => {
        expect(() =>
          localPromptFileManagement.getPromptFileContent(promptHandle),
        ).toThrow();
      });

      describe("when remote is updated", () => {
        it("should get the updated version", async () => {
          await langwatch.prompts.update(promptHandle, {
            temperature: 0.8,
            model: "gpt-4-turbo",
            messages: [
              { role: "system", content: "I am an updated system message." },
            ],
          });

          const sync = cli.run("prompt sync");
          expectCliResultSuccess(sync);

          expect(
            materializedPromptFileManagement.getPromptFileContent(promptHandle),
          ).toMatchInlineSnapshot(`
            "model: gpt-4-turbo
            messages:
              - role: system
                content: I am an updated system message.
            modelParameters:
              temperature: 0.8
            "
          `);
        });
      });

      describe("when pegged to a version", () => {
        it("should sync the correct version", async () => {
          const addResult = await cli.runInteractive(
            `prompt add ${promptHandle}@0`,
            ["y"],
          );
          expectCliResultSuccess(addResult);

          const sync = cli.run("prompt sync");
          expectCliResultSuccess(sync);

          expect(
            materializedPromptFileManagement.getPromptFileContent(promptHandle),
          ).toMatchInlineSnapshot(`
            "model: gpt-4-turbo
            messages:
              - role: system
                content: You are a helpful assistant.
            modelParameters:
              temperature: 0.9
            "
          `);
        });
      });
    });
  });
});
