import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { getLangwatchSDK } from "../../helpers/get-sdk";
import type { LangWatch } from "../../../dist/index.js";
import { server } from "../setup/msw-setup";
import { handles } from "./handlers.js";

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

  it("get prompt", async () => {
    const prompt = await langwatch.prompts.get("123");
    expect(prompt?.id).toBe("123");
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
});
