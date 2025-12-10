import {
  describe,
  expect,
  it,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from "vitest";
import { getLangwatchSDK } from "../../helpers/get-sdk";
import type { LangWatch } from "../../../dist/index.js";
import { server } from "../setup/msw-setup";
import { handles, http } from "./handlers.js";
import { type CliRunner } from "../cli/helpers/cli-runner.js";
import {
  createLocalPromptFile,
  setupCliRunner,
  teardownCliRunner,
} from "./cli-helpers";

describe("Prompt management", () => {
  let langwatch: LangWatch;

  beforeAll(async () => {
    const { LangWatch } = await getLangwatchSDK();
    langwatch = new LangWatch({
      apiKey: process.env.LANGWATCH_API_KEY,
      endpoint: process.env.LANGWATCH_ENDPOINT
    });
  });

  beforeEach(() => {
    server.use(...handles);
  });

  it("create prompt", async () => {
    const prompt = await langwatch.prompts.create({
      handle: "test",
    });
    expect(prompt?.handle).toBe("test");
  });

  it("update prompt", async () => {
    const systemPrompt = "test system prompt";
    const prompt = await langwatch.prompts.update("handle", {
      prompt: systemPrompt,
    });

    expect(prompt.prompt).toBe(systemPrompt);
  });

  it("delete prompt", async () => {
    const result = await langwatch.prompts.delete("handle");
    expect(result).toEqual({ success: true });
  });


  /**
   * Because this uses a tmp directory and the project root will be
   * cached by the FileManager (inside LangWatch), we need to run
   * all of these tests in a beforeAll, otherwise we create a new
   * tmp directory for each test and the manager will fail to find
   * the project root correctly
   */
  describe("get prompt", () => {
    let cli: CliRunner;
    let testDir: string;
    let originalCwd: string;

    beforeAll(() => {
      const setupResult = setupCliRunner();
      cli = setupResult.cli;
      testDir = setupResult.testDir;
      console.log("testDir", testDir);
      originalCwd = setupResult.originalCwd;
    });

    afterAll(() => {
      teardownCliRunner({ testDir, originalCwd });
    });

    describe("when no local prompt file is present", () => {
      it("gets the server prompt", async () => {
        const prompt = await langwatch.prompts.get("123");
        expect(prompt?.id).toBe("123");
      });
    });

    describe("when local prompt file is present", () => {
      const handle = "my-test-prompt";

      beforeAll(() => {
        createLocalPromptFile({ handle, cli, testDir });
      });

      describe("gets the local prompt", () => {
        let prompt: any;

        beforeAll(async () => {
          prompt = await langwatch.prompts.get(handle);
        });

        it("should return prompt", async () => {
          expect(prompt?.handle).toBe(handle);
        });

        it("should not call the api", async () => {
          const mock = vi.fn();
          server.use(http.get("/api/prompts/{id}", mock));
          expect(mock).not.toHaveBeenCalled();
        });
      });
    });

  });
});
