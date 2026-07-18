import { z } from "zod";

// Zod schema for local prompt config with permissive validation.
//
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
    parameters: z.record(z.string(), z.unknown()).optional().default({}),
  })
  .loose();

export type LocalPromptConfig = z.infer<typeof localPromptConfigSchema>;
