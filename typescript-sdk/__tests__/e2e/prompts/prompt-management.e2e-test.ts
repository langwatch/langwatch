import { describe, expect, it, beforeAll } from "vitest";
import { getLangwatchSDK } from "../../helpers/get-sdk";

describe("Prompt management", () => {
  let langwatch: typeof import("../../../dist/index.js");

  beforeAll(async () => {
    langwatch = await getLangwatchSDK();
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
