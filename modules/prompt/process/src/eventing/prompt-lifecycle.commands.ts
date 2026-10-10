import type { Command, CommandHandler } from "@langwatch/eventing";
import {
  createTenantId,
  defineCommandSchema,
  EventSchema,
  EventUtils,
  stripEnvelope,
  withCommandEnvelope,
} from "@langwatch/eventing";
import {
  PROMPT_CREATED_EVENT_TYPE,
  promptCreatedEventDataSchema,
} from "@langwatch/prompt-contract";
import { z } from "zod";

/** Prompt's own lifecycle: every project write that gives it a new prompt. */
export const PROMPT_LIFECYCLE_PIPELINE_NAME = "prompt_lifecycle" as const;
export const PROMPT_AGGREGATE_TYPE = "prompt" as const;

const PROMPT_CREATED_EVENT_VERSION = "2026-09-29" as const;
const RECORD_PROMPT_CREATED_COMMAND_TYPE = "lw.prompt.record_created" as const;

export const promptCreatedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(PROMPT_CREATED_EVENT_TYPE),
  version: z.literal(PROMPT_CREATED_EVENT_VERSION),
  data: promptCreatedEventDataSchema,
});
type PromptCreatedEvent = z.infer<typeof promptCreatedEventSchema>;
export type PromptLifecycleEvent = PromptCreatedEvent;

const recordPromptCreatedCommandDataSchema = withCommandEnvelope(promptCreatedEventDataSchema);
export type RecordPromptCreatedCommandData = z.infer<typeof recordPromptCreatedCommandDataSchema>;

/** Records that a project gained a prompt; one event per prompt, however often it is sent. */
export class RecordPromptCreatedCommand implements CommandHandler<
  Command<RecordPromptCreatedCommandData>,
  PromptCreatedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_PROMPT_CREATED_COMMAND_TYPE,
    recordPromptCreatedCommandDataSchema,
    "Record that a project gained a prompt",
  );

  handle(command: Command<RecordPromptCreatedCommandData>): PromptCreatedEvent[] {
    const data = stripEnvelope(command.data);
    return [
      EventUtils.createEvent<PromptCreatedEvent>({
        aggregateType: PROMPT_AGGREGATE_TYPE,
        aggregateId: data.promptId,
        tenantId: createTenantId(command.tenantId),
        type: PROMPT_CREATED_EVENT_TYPE,
        version: PROMPT_CREATED_EVENT_VERSION,
        data: { ...data, occurredAt: command.data.occurredAt },
        occurredAt: command.data.occurredAt,
        idempotencyKey: `${command.tenantId}:${data.promptId}:created`,
      }),
    ];
  }

  static getAggregateId(payload: RecordPromptCreatedCommandData): string {
    return payload.promptId;
  }
}
