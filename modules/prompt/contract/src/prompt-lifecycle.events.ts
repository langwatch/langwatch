import { z } from "zod";

/** Prompt's own lifecycle facts, which peers react to from their own side (§9). */
export const PROMPT_CREATED_EVENT_TYPE = "lw.prompt.created" as const;

/** A project gained a prompt (write, copy or sync), the org-wide count including it, and when. */
export const promptCreatedEventDataSchema = z.object({
  promptId: z.string(),
  projectId: z.string(),
  userId: z.string(),
  orgPromptCount: z.number().int().positive(),
  occurredAt: z.number().int().nonnegative(),
});
export type PromptCreatedEventData = z.infer<typeof promptCreatedEventDataSchema>;
