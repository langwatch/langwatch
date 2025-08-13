import { describe, expect, it, beforeAll } from "vitest";
import { getLangwatchSDK } from "../../helpers/get-sdk";
import type { LangWatch } from "../../../dist/index.js";

describe("Prompt management", () => {
  let langwatch: LangWatch;

  beforeAll(async () => {
    const { LangWatch } = await getLangwatchSDK();
    langwatch = new LangWatch({
      apiKey: "test-key",
      endpoint: "https://app.langwatch.test",
    });
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
    const newName = "chunky-bacon";
    const prompt = await langwatch.prompts.update("handle", {
      name: newName,
    });
    // Internally, update calls get again, so it
    // it doesn't make sense to check the name
    expect(prompt).toBeDefined();
  });

  it("delete prompt", async () => {
    const result = await langwatch.prompts.delete("handle");
    expect(result).toEqual({ success: true });
  });
});
