/**
 * @vitest-environment node
 * @see specs/api-reference/response-documentation.feature
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createPromptInputSchema,
  idParamsSchema,
  idVersionParamsSchema,
  syncInputSchema,
  tagParamsSchema,
  updatePromptInputSchema,
} from "../prompt-rest.schemas.ts";

describe("the create-prompt request schema", () => {
  /** @scenario "A create whose body a shape alone cannot describe publishes an example" */
  it("publishes a worked example the schema alone could not imply", () => {
    const published = z.toJSONSchema(createPromptInputSchema, { io: "input" }) as {
      examples?: unknown[];
    };
    const [example] = published.examples ?? [];

    expect(example).toBeDefined();
    // The rule the shape cannot state: one of `prompt`/`messages` is required.
    expect(example).toHaveProperty("prompt");
    expect(createPromptInputSchema.validate(example)).toBe(true);
  });
});

describe("a prompt body carrying a null byte", () => {
  /** @scenario "a prompt field carrying a null byte is refused as a bad request" */
  it("is refused on create, update and sync", () => {
    expect(createPromptInputSchema.validate({ handle: "a", prompt: "x\u0000y" })).toBe(false);
    expect(
      createPromptInputSchema.validate({
        handle: "a",
        messages: [{ role: "user", content: "x\u0000y" }],
      }),
    ).toBe(false);
    expect(updatePromptInputSchema.validate({ commitMessage: "x\u0000y" })).toBe(false);
    expect(createPromptInputSchema.validate({ handle: "a", prompt: "p", model: "m\u0000" })).toBe(
      false,
    );
    expect(
      syncInputSchema.validate({
        configData: {
          prompt: "x\u0000y",
          model: "openai/gpt-5",
          outputs: [{ identifier: "output", type: "str" }],
        },
      }),
    ).toBe(false);
  });

  it("still accepts the same body without it", () => {
    expect(createPromptInputSchema.validate({ handle: "a", prompt: "xy" })).toBe(true);
  });
});

describe("a prompt address carrying a null byte", () => {
  /** @scenario "a prompt field carrying a null byte is refused as a bad request" */
  it("is refused in the id, tag and version parameters", () => {
    expect(idParamsSchema.validate({ id: "a\u0000b" })).toBe(false);
    expect(tagParamsSchema.validate({ tag: "a\u0000b" })).toBe(false);
    expect(idVersionParamsSchema.validate({ id: "a", versionId: "b\u0000" })).toBe(false);
    expect(idParamsSchema.validate({ id: "ab" })).toBe(true);
  });
});
