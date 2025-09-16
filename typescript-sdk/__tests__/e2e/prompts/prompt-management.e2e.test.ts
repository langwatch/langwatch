import {
  describe,
  expect,
  it,
  beforeAll,
  beforeEach,
  afterEach,
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
} from "./helpers";

describe("Prompt management", () => {
  let langwatch: LangWatch;

  beforeAll(async () => {
    const { LangWatch } = await getLangwatchSDK();
    langwatch = new LangWatch({
      apiKey: "test-key",
      endpoint: process.env.LANGWATCH_API_URL ?? "https://app.langwatch.test",
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

  describe("get prompt", () => {
    describe("when no local prompt file is present", () => {
      it("gets the server prompt", async () => {
        const prompt = await langwatch.prompts.get("123");
        expect(prompt?.id).toBe("123");
      });
    });

    describe("when local prompt file is present", () => {
      const handle = "my-test-prompt";
      let testDir: string;
      let originalCwd: string;
      let cli: CliRunner;

      beforeEach(() => {
        const setupResult = setupCliRunner();
        cli = setupResult.cli;
        testDir = setupResult.testDir;
        createLocalPromptFile({ handle, cli, testDir });
        originalCwd = setupResult.originalCwd;
        cli = setupResult.cli;
      });

      afterEach(async () => {
        teardownCliRunner({ testDir, originalCwd });
      });

      describe("gets the local prompt", () => {
        let prompt: any;

        beforeEach(async () => {
          prompt = await langwatch.prompts.get(handle);
        });

        it("should return prompt", async () => {
          expect(prompt?.handle).toBe(handle);
        });

        it("should not call the api", async () => {
          const mock = vi.fn();
          server.use(http.get("/api/prompts/{id}", mock));
          expect(prompt?.handle).toBe(handle);
          expect(mock).not.toHaveBeenCalled();
        });
      });
    });
  });
});
