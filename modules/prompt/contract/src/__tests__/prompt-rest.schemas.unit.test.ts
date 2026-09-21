/**
 * @vitest-environment node
 * @see specs/api-reference/response-documentation.feature
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createPromptInputSchema } from "../prompt-rest.schemas.ts";

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
    expect(createPromptInputSchema.safeParse(example).success).toBe(true);
  });
});
