import { describe, expect, it } from "vitest";

import { createPromptCommandSchema, promptConfigDataSchema, promptHandleSchema } from "../index.ts";

describe("Prompt contract", () => {
  it("accepts the portable prompt configuration shape", () => {
    expect(
      promptConfigDataSchema.parse({
        prompt: "Hello {{name}}",
        messages: [],
        inputs: [{ identifier: "name", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        model: "openai/gpt-5-mini",
      }).model,
    ).toBe("openai/gpt-5-mini");
  });

  /** @scenario invalid handles are rejected at the contract boundary */
  it("rejects invalid handles before persistence", () => {
    expect(promptHandleSchema.validate("Invalid Handle")).toBe(false);
    expect(promptHandleSchema.validate("support-bot/v1")).toBe(true);
  });

  it("requires a project and handle for creation", () => {
    expect(createPromptCommandSchema.validate({ projectId: "p1", handle: "support-bot" })).toBe(
      true,
    );
    expect(createPromptCommandSchema.validate({ projectId: "", handle: "support-bot" })).toBe(
      false,
    );
  });
});
