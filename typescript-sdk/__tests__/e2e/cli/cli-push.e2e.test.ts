// @vitest-environment node
// @vitest-config ./vitest.e2e.config.mts

import {
  describe,
  expect,
  it,
  afterEach,
  beforeEach,
  afterAll,
  beforeAll,
} from "vitest";
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
  let lockFileManager: LockFileManager;
  let cli: CliRunner;

  beforeAll(() => {
    if (fs.existsSync(TMP_BASE_DIR)) {
      fs.rmSync(TMP_BASE_DIR, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    langwatch = new LangWatch({
      apiKey: process.env.LANGWATCH_API_KEY,
      endpoint: process.env.LANGWATCH_ENDPOINT,
    });
    fs.mkdirSync(TMP_BASE_DIR, { recursive: true });
    testDir = fs.mkdtempSync(path.join(TMP_BASE_DIR, "langwatch-push-"));
    originalCwd = process.cwd();
    process.chdir(testDir);
    cli = new CliRunner({ cwd: testDir });
    localPromptFileManagement = new PromptFileManager({ cwd: testDir });
    lockFileManager = new LockFileManager({ cwd: testDir });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
  });

  afterAll(async () => {
    const apiHelpers = new ApiHelpers(langwatch);
    await apiHelpers.cleapUpTestPrompts();
  });

  describe("push", () => {
    describe("when local prompt exists", () => {
      it("creates prompt on remote", async () => {
        const initResult = cli.run("prompt init");
        expectCliResultSuccess(initResult);

        const promptHandle = createUniquePromptName();
        const createResult = cli.run(`prompt create ${promptHandle}`);
        expectCliResultSuccess(createResult);

        const filePath =
          localPromptFileManagement.getPromptFilePath(promptHandle);
        cli.run(`prompt add ${promptHandle} ${filePath}`);

        const pushResult = cli.run("prompt push");
        expectCliResultSuccess(pushResult);
        expect(pushResult.output).toContain(`Pushed`);

        // Verify remote prompt was created
        const remotePrompt = await langwatch.prompts.get(promptHandle);
        expect(remotePrompt).not.toBeNull();
        expect(remotePrompt!.model).toBe("openai/gpt-5");

        // Verify lock file was updated
        const lock = lockFileManager.readLockFile();
        expect(lock).not.toBeNull();
        expect(lock!.prompts[promptHandle]).toBeDefined();
        expect(lock!.prompts[promptHandle]!.version).toBe(1);
      });
    });

    describe("when local prompt is updated", () => {
      it("updates the remote prompt", async () => {
        const initResult = cli.run("prompt init");
        expectCliResultSuccess(initResult);

        const promptHandle = createUniquePromptName();
        const createResult = cli.run(`prompt create ${promptHandle}`);
        expectCliResultSuccess(createResult);

        const filePath =
          localPromptFileManagement.getPromptFilePath(promptHandle);
        cli.run(`prompt add ${promptHandle} ${filePath}`);

        // First push
        const push1 = cli.run("prompt push");
        expectCliResultSuccess(push1);

        // Modify local file
        localPromptFileManagement.updatePromptFile(promptHandle, {
          model: "gpt-4-turbo",
          modelParameters: { temperature: 0.9 },
          messages: [
            { role: "system", content: "Updated system message." },
            { role: "user", content: "Updated user message." },
          ],
        });

        // Second push
        const push2 = cli.run("prompt push");
        expectCliResultSuccess(push2);

        // Verify remote is updated
        const remotePrompt = await langwatch.prompts.get(promptHandle);
        expect(remotePrompt).not.toBeNull();
        expect(remotePrompt!.model).toBe("gpt-4-turbo");
        expect(remotePrompt!.temperature).toBe(0.9);

        // Verify version incremented
        const lock = lockFileManager.readLockFile();
        expect(lock!.prompts[promptHandle]!.version).toBe(2);
      });
    });

    it("reports no changes when already up to date", async () => {
      const initResult = cli.run("prompt init");
      expectCliResultSuccess(initResult);

      const promptHandle = createUniquePromptName();
      const createResult = cli.run(`prompt create ${promptHandle}`);
      expectCliResultSuccess(createResult);

      const filePath =
        localPromptFileManagement.getPromptFilePath(promptHandle);
      cli.run(`prompt add ${promptHandle} ${filePath}`);

      // First push
      cli.run("prompt push");

      // Second push - should report no changes
      const push2 = cli.run("prompt push");
      expectCliResultSuccess(push2);
      expect(push2.output).toContain("no changes");
    });

    it("does not update remote prompts that were already materialized", async () => {
      const promptHandle = createUniquePromptName();
      await langwatch.prompts.create({
        handle: promptHandle,
        model: "gpt-4-turbo",
        temperature: 0.9,
        prompt: "You are a helpful assistant.",
      });

      const initResult = cli.run("prompt init");
      expectCliResultSuccess(initResult);

      const addResult = await cli.runInteractive(
        `prompt add ${promptHandle}@latest`,
        ["y"],
      );
      expectCliResultSuccess(addResult);

      // First sync to materialize the remote prompt
      const syncResult = cli.run("prompt sync");
      expectCliResultSuccess(syncResult);

      // Now update the remote prompt
      await langwatch.prompts.update(promptHandle, {
        commitMessage: "Updated remotely",
        temperature: 0.1,
        model: "gpt-4-turbo",
        messages: [
          { role: "system", content: "Remotely updated message." },
        ],
      });

      // Push should NOT pull the remote update
      const pushResult = cli.run("prompt push");
      expectCliResultSuccess(pushResult);
      expect(pushResult.output).toContain("no changes");

      // The materialized file should still have the original content
      const materializedPromptFileManagement = new PromptFileManager({
        cwd: testDir,
        materializedDir: true,
      });
      const content = materializedPromptFileManagement.getPromptFileContent(promptHandle);
      expect(content).not.toContain("Remotely updated message.");
    });
  });
});
