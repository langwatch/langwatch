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

  it("strips unknown keys instead of refusing them, as main's configData did", () => {
    const parsed = promptConfigDataSchema.parse({
      prompt: "Hello",
      outputs: [{ identifier: "output", type: "str", legacy: true }],
      model: "openai/gpt-5-mini",
      demonstrations: { id: "d1", legacyColumn: "x" },
      legacyField: 1,
    });

    expect(parsed).not.toHaveProperty("legacyField");
    expect(parsed.demonstrations).toEqual({ id: "d1" });
    expect(parsed.outputs[0]).toEqual({ identifier: "output", type: "str" });
  });

  it("strips an unknown key from a create command, as main's tRPC create input did", () => {
    const parsed = createPromptCommandSchema.parse({
      projectId: "p1",
      handle: "support-bot",
      legacyField: 1,
    });

    expect(parsed).toEqual({ projectId: "p1", handle: "support-bot" });
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
