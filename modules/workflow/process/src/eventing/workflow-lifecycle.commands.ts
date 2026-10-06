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
  WORKFLOW_CREATED_EVENT_TYPE,
  workflowCreatedEventDataSchema,
} from "@langwatch/workflow-contract";
import { z } from "zod";

/** The workflow's own lifecycle, apart from its runs. */
export const WORKFLOW_LIFECYCLE_PIPELINE_NAME = "workflow_lifecycle" as const;
export const WORKFLOW_AGGREGATE_TYPE = "workflow" as const;

export const WORKFLOW_CREATED_EVENT_VERSION = "2026-09-29" as const;
export const RECORD_WORKFLOW_CREATED_COMMAND_TYPE = "lw.workflow.record_created" as const;

export const workflowCreatedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(WORKFLOW_CREATED_EVENT_TYPE),
  version: z.literal(WORKFLOW_CREATED_EVENT_VERSION),
  data: workflowCreatedEventDataSchema,
});
export type WorkflowCreatedEvent = z.infer<typeof workflowCreatedEventSchema>;
export type WorkflowLifecycleEvent = WorkflowCreatedEvent;

const recordWorkflowCreatedCommandDataSchema = withCommandEnvelope(workflowCreatedEventDataSchema);
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
