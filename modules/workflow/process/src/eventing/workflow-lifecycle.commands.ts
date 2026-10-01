import type { Command, CommandHandler } from "@langwatch/eventing";
import {
  createTenantId,
  defineCommandSchema,
  EventUtils,
  stripEnvelope,
  withCommandEnvelope,
} from "@langwatch/eventing";
import {
  WORKFLOW_CREATED_EVENT_TYPE,
  workflowCreatedEventDataSchema,
} from "@langwatch/workflow-contract";
import type { z } from "zod";

import {
  RECORD_WORKFLOW_CREATED_COMMAND_TYPE,
  WORKFLOW_AGGREGATE_TYPE,
  WORKFLOW_CREATED_EVENT_VERSION,
  type WorkflowCreatedEvent,
} from "./workflow-lifecycle.events.ts";

export const recordWorkflowCreatedCommandDataSchema = withCommandEnvelope(
  workflowCreatedEventDataSchema,
);
export type RecordWorkflowCreatedCommandData = z.infer<
  typeof recordWorkflowCreatedCommandDataSchema
>;

/** Records that a workflow was created; one event per workflow, however often it is sent. */
export class RecordWorkflowCreatedCommand implements CommandHandler<
  Command<RecordWorkflowCreatedCommandData>,
  WorkflowCreatedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_WORKFLOW_CREATED_COMMAND_TYPE,
    recordWorkflowCreatedCommandDataSchema,
    "Record that a workflow was created",
  );

  handle(command: Command<RecordWorkflowCreatedCommandData>): WorkflowCreatedEvent[] {
    const data = stripEnvelope(command.data);
    return [
      EventUtils.createEvent<WorkflowCreatedEvent>({
        aggregateType: WORKFLOW_AGGREGATE_TYPE,
        aggregateId: data.workflowId,
        tenantId: createTenantId(command.tenantId),
        type: WORKFLOW_CREATED_EVENT_TYPE,
        version: WORKFLOW_CREATED_EVENT_VERSION,
        data: { ...data, occurredAt: command.data.occurredAt },
        occurredAt: command.data.occurredAt,
        idempotencyKey: `${command.tenantId}:${data.workflowId}:created`,
      }),
    ];
  }

  static getAggregateId(payload: RecordWorkflowCreatedCommandData): string {
    return payload.workflowId;
  }
}
