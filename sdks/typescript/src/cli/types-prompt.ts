import { z } from "zod";

import type { JsonValue } from "./types";

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

// Kept OUT of `types.ts` on purpose: `types.ts` is imported by `program.ts`,
// which is on the always-loaded cold-start path of every CLI invocation, and
// zod costs ~39ms to load. Only the prompt commands need this schema, and
// they are lazy-loaded behind dynamic imports, so the cost is paid only when
// a prompt command actually runs.
export const localPromptConfigSchema = z
  .object({
    model: z.string().min(1, "Model is required"),
    modelParameters: z
      .object({
        temperature: z.number().optional(),
        max_tokens: z.number().optional(),
      })
      .loose()
      .optional(),
    messages: z
      .array(
        z
          .object({
            role: z.enum(["system", "user", "assistant"]),
            content: z.string().min(1, "Message content cannot be empty"),
          })
          .loose(),
      )
      .min(1, "At least one message is required"),
    // Parameters persist as JSON: parse them AS json so the value's type
    // matches the API contract (the spec's recursive JsonValue) instead of
    // laundering unknowns into a typed pipeline.
    parameters: z.record(z.string(), jsonValueSchema).optional().default({}),
  })
  .loose();

export type LocalPromptConfig = z.infer<typeof localPromptConfigSchema>;
