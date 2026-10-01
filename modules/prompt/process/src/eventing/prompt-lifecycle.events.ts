import { EventSchema } from "@langwatch/eventing";
import {
  PROMPT_CREATED_EVENT_TYPE,
  promptCreatedEventDataSchema,
} from "@langwatch/prompt-contract";
import { z } from "zod";

/** Prompt's own lifecycle: every project write that gives it a new prompt. */
export const PROMPT_LIFECYCLE_PIPELINE_NAME = "prompt_lifecycle" as const;
export const PROMPT_AGGREGATE_TYPE = "prompt" as const;

export const PROMPT_CREATED_EVENT_VERSION = "2026-09-29" as const;
export const RECORD_PROMPT_CREATED_COMMAND_TYPE = "lw.prompt.record_created" as const;

export const promptCreatedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(PROMPT_CREATED_EVENT_TYPE),
  version: z.literal(PROMPT_CREATED_EVENT_VERSION),
  data: promptCreatedEventDataSchema,
});
export type PromptCreatedEvent = z.infer<typeof promptCreatedEventSchema>;
export type PromptLifecycleEvent = PromptCreatedEvent;
