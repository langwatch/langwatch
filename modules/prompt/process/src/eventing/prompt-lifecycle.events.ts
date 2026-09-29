import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

/** Prompt's own lifecycle: every project write that gives it a new prompt. */
export const PROMPT_LIFECYCLE_PIPELINE_NAME = "prompt_lifecycle" as const;
export const PROMPT_AGGREGATE_TYPE = "prompt" as const;

export const PROMPT_CREATED_EVENT_TYPE = "lw.prompt.created" as const;
export const PROMPT_CREATED_EVENT_VERSION = "2026-09-29" as const;
export const RECORD_PROMPT_CREATED_COMMAND_TYPE = "lw.prompt.record_created" as const;

/** A project gained a prompt (write, copy or sync), and the org-wide count including it. */
export const promptCreatedEventDataSchema = z.object({
  promptId: z.string(),
  projectId: z.string(),
  userId: z.string(),
  orgPromptCount: z.number().int().positive(),
});

export const promptCreatedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(PROMPT_CREATED_EVENT_TYPE),
  version: z.literal(PROMPT_CREATED_EVENT_VERSION),
  data: promptCreatedEventDataSchema,
});
export type PromptCreatedEvent = z.infer<typeof promptCreatedEventSchema>;
export type PromptLifecycleEvent = PromptCreatedEvent;
