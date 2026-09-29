import type { Command, CommandHandler } from "@langwatch/eventing";
import {
  createTenantId,
  defineCommandSchema,
  EventUtils,
  stripEnvelope,
  withCommandEnvelope,
} from "@langwatch/eventing";
import type { z } from "zod";

import {
  PROMPT_AGGREGATE_TYPE,
  PROMPT_CREATED_EVENT_TYPE,
  PROMPT_CREATED_EVENT_VERSION,
  RECORD_PROMPT_CREATED_COMMAND_TYPE,
  promptCreatedEventDataSchema,
  type PromptCreatedEvent,
} from "./prompt-lifecycle.events.ts";

export const recordPromptCreatedCommandDataSchema = withCommandEnvelope(
  promptCreatedEventDataSchema,
);
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
        data,
        occurredAt: command.data.occurredAt,
        idempotencyKey: `${command.tenantId}:${data.promptId}:created`,
      }),
    ];
  }

  static getAggregateId(payload: RecordPromptCreatedCommandData): string {
    return payload.promptId;
  }
}
