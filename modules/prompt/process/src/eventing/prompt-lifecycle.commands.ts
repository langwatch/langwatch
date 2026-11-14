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
  PROMPT_DELETED_EVENT_TYPE,
  PROMPT_VERSION_SAVED_EVENT_TYPE,
  promptCreatedEventDataSchema,
  promptDeletedEventDataSchema,
  promptVersionSavedEventDataSchema,
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
export type PromptLifecycleEvent =
  | PromptCreatedEvent
  | PromptVersionSavedEvent
  | PromptDeletedEvent;

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

const PROMPT_VERSION_SAVED_EVENT_VERSION = "2026-11-09" as const;
const RECORD_PROMPT_VERSION_SAVED_COMMAND_TYPE = "lw.prompt.record_version_saved" as const;

export const promptVersionSavedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(PROMPT_VERSION_SAVED_EVENT_TYPE),
  version: z.literal(PROMPT_VERSION_SAVED_EVENT_VERSION),
  data: promptVersionSavedEventDataSchema,
});
type PromptVersionSavedEvent = z.infer<typeof promptVersionSavedEventSchema>;

const recordPromptVersionSavedCommandDataSchema = withCommandEnvelope(
  promptVersionSavedEventDataSchema,
);
export type RecordPromptVersionSavedCommandData = z.infer<
  typeof recordPromptVersionSavedCommandDataSchema
>;

/** Records that a prompt got a new version; one event per version, however often it is sent. */
export class RecordPromptVersionSavedCommand implements CommandHandler<
  Command<RecordPromptVersionSavedCommandData>,
  PromptVersionSavedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_PROMPT_VERSION_SAVED_COMMAND_TYPE,
    recordPromptVersionSavedCommandDataSchema,
    "Record that a prompt got a new version",
  );

  handle(command: Command<RecordPromptVersionSavedCommandData>): PromptVersionSavedEvent[] {
    const data = stripEnvelope(command.data);
    return [
      EventUtils.createEvent<PromptVersionSavedEvent>({
        aggregateType: PROMPT_AGGREGATE_TYPE,
        aggregateId: data.promptId,
        tenantId: createTenantId(command.tenantId),
        type: PROMPT_VERSION_SAVED_EVENT_TYPE,
        version: PROMPT_VERSION_SAVED_EVENT_VERSION,
        data: { ...data, occurredAt: command.data.occurredAt },
        occurredAt: command.data.occurredAt,
        idempotencyKey: `${command.tenantId}:${data.promptId}:version:${data.versionId}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordPromptVersionSavedCommandData): string {
    return payload.promptId;
  }
}

const PROMPT_DELETED_EVENT_VERSION = "2026-11-09" as const;
const RECORD_PROMPT_DELETED_COMMAND_TYPE = "lw.prompt.record_deleted" as const;

export const promptDeletedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(PROMPT_DELETED_EVENT_TYPE),
  version: z.literal(PROMPT_DELETED_EVENT_VERSION),
  data: promptDeletedEventDataSchema,
});
type PromptDeletedEvent = z.infer<typeof promptDeletedEventSchema>;

const recordPromptDeletedCommandDataSchema = withCommandEnvelope(promptDeletedEventDataSchema);
export type RecordPromptDeletedCommandData = z.infer<typeof recordPromptDeletedCommandDataSchema>;

/** Records that a prompt was removed; one event per prompt, however often it is sent. */
export class RecordPromptDeletedCommand implements CommandHandler<
  Command<RecordPromptDeletedCommandData>,
  PromptDeletedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_PROMPT_DELETED_COMMAND_TYPE,
    recordPromptDeletedCommandDataSchema,
    "Record that a prompt was removed",
  );

  handle(command: Command<RecordPromptDeletedCommandData>): PromptDeletedEvent[] {
    const data = stripEnvelope(command.data);
    return [
      EventUtils.createEvent<PromptDeletedEvent>({
        aggregateType: PROMPT_AGGREGATE_TYPE,
        aggregateId: data.promptId,
        tenantId: createTenantId(command.tenantId),
        type: PROMPT_DELETED_EVENT_TYPE,
        version: PROMPT_DELETED_EVENT_VERSION,
        data: { ...data, occurredAt: command.data.occurredAt },
        occurredAt: command.data.occurredAt,
        idempotencyKey: `${command.tenantId}:${data.promptId}:deleted`,
      }),
    ];
  }

  static getAggregateId(payload: RecordPromptDeletedCommandData): string {
    return payload.promptId;
  }
}
