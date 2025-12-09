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
import type { LangWatch, FetchPolicy as FetchPolicyType } from "../../../dist/index.js";
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

    describe("FetchPolicy", () => {
      let FetchPolicy: typeof FetchPolicyType;

      beforeAll(async () => {
        const sdk = await getLangwatchSDK();
        FetchPolicy = sdk.FetchPolicy;
      });

      describe("ALWAYS_FETCH", () => {
        const handle = "always-fetch-prompt";

        beforeAll(() => {
          createLocalPromptFile({ handle, cli, testDir });
        });

        it("falls back to local when API fails", async () => {
          server.use(
            http.get("/api/prompts/{id}", ({ response }) => {
              return response(500).json({ error: "Server error" });
            })
          );

          const prompt = await langwatch.prompts.get(handle, {
            fetchPolicy: FetchPolicy.ALWAYS_FETCH,
          });

          expect(prompt?.handle).toBe(handle);
        });
      });

      describe("MATERIALIZED_ONLY", () => {
        const existingHandle = "materialized-only-prompt";

        beforeAll(() => {
          createLocalPromptFile({ handle: existingHandle, cli, testDir });
        });

        it("returns local prompt without calling API", async () => {
          const prompt = await langwatch.prompts.get(existingHandle, {
            fetchPolicy: FetchPolicy.MATERIALIZED_ONLY,
          });

          expect(prompt?.handle).toBe(existingHandle);
        });

        it("throws when local file not found", async () => {
          await expect(
            langwatch.prompts.get("non-existent-prompt", {
              fetchPolicy: FetchPolicy.MATERIALIZED_ONLY,
            })
          ).rejects.toThrow();
        });
      });
    });
  });
});
