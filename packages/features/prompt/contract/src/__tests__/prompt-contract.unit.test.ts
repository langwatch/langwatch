import { describe, expect, it } from "vitest";
import {
  createPromptCommandSchema,
  promptConfigDataSchema,
  promptHandleSchema,
} from "../index";

describe("Prompt contract", () => {
  it("accepts the portable prompt configuration shape", () => {
    expect(
      promptConfigDataSchema.parse({
        prompt: "Hello {{name}}",
        messages: [],
        inputs: [{ identifier: "name", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        model: "openai/gpt-4o",
      }).model,
    ).toBe("openai/gpt-4o");
  });

  /** @scenario invalid handles are rejected at the contract boundary */
  it("rejects invalid handles before persistence", () => {
    expect(promptHandleSchema.safeParse("Invalid Handle").success).toBe(false);
    expect(promptHandleSchema.safeParse("support-bot/v1").success).toBe(true);
  });

  it("requires a project and handle for creation", () => {
    expect(
      createPromptCommandSchema.safeParse({ projectId: "p1", handle: "support-bot" })
        .success,
    ).toBe(true);
    expect(
      createPromptCommandSchema.safeParse({ projectId: "", handle: "support-bot" })
        .success,
    ).toBe(false);
  });
});
