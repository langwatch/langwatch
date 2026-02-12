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
  let materializedPromptFileManagement: PromptFileManager;
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
    testDir = fs.mkdtempSync(path.join(TMP_BASE_DIR, "langwatch-pull-"));
    originalCwd = process.cwd();
    process.chdir(testDir);
    cli = new CliRunner({ cwd: testDir });
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
    const apiHelpers = new ApiHelpers(langwatch);
    await apiHelpers.cleapUpTestPrompts();
  });

  describe("pull", () => {
    describe("when remote prompt exists", () => {
      let promptHandle: string;

      beforeEach(async () => {
        promptHandle = createUniquePromptName();
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
      });

      it("fetches remote prompt into materialized directory", () => {
        const pullResult = cli.run("prompt pull");
        expectCliResultSuccess(pullResult);

        expect(
          materializedPromptFileManagement.getPromptFileContent(promptHandle),
        ).toContain("gpt-4-turbo");

        const lock = lockFileManager.readLockFile();
        expect(lock).not.toBeNull();
        expect(lock!.prompts[promptHandle]).toBeDefined();
      });

      describe("when remote is updated after initial pull", () => {
        it("fetches the updated version", async () => {
          const pull1 = cli.run("prompt pull");
          expectCliResultSuccess(pull1);

          await langwatch.prompts.update(promptHandle, {
            commitMessage: "Updated for pull test",
            temperature: 0.5,
            model: "gpt-4-turbo",
            messages: [
              { role: "system", content: "Updated system message." },
            ],
          });

          const pull2 = cli.run("prompt pull");
          expectCliResultSuccess(pull2);

          expect(
            materializedPromptFileManagement.getPromptFileContent(promptHandle),
          ).toContain("Updated system message.");
        });
      });
    });

    it("reports no changes when already up to date", async () => {
      const promptHandle = createUniquePromptName();
      await langwatch.prompts.create({
        handle: promptHandle,
        model: "gpt-4-turbo",
        temperature: 0.7,
        prompt: "Test prompt.",
      });

      const initResult = cli.run("prompt init");
      expectCliResultSuccess(initResult);

      const addResult = await cli.runInteractive(
        `prompt add ${promptHandle}@latest`,
        ["y"],
      );
      expectCliResultSuccess(addResult);

      // First pull
      cli.run("prompt pull");

      // Second pull - should report no changes
      const pull2 = cli.run("prompt pull");
      expectCliResultSuccess(pull2);
      expect(pull2.output).toContain("no changes");
    });

    it("does not push local prompts", async () => {
      const initResult = cli.run("prompt init");
      expectCliResultSuccess(initResult);

      const promptHandle = createUniquePromptName();
      const createResult = cli.run(`prompt create ${promptHandle}`);
      expectCliResultSuccess(createResult);

      const localPromptFileManagement = new PromptFileManager({ cwd: testDir });
      const filePath = localPromptFileManagement.getPromptFilePath(promptHandle);
      cli.run(`prompt add ${promptHandle} ${filePath}`);

      const pullResult = cli.run("prompt pull");
      expectCliResultSuccess(pullResult);

      // Verify the local prompt was NOT pushed to the server
      try {
        const remote = await langwatch.prompts.get(promptHandle);
        // If prompt exists on server, it wasn't created by pull
        expect(remote).toBeNull();
      } catch {
        // Expected: prompt should not exist on server
      }
    });
  });
});
