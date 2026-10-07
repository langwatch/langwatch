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
  WORKFLOW_VERSION_SAVED_EVENT_TYPE,
  workflowCreatedEventDataSchema,
  workflowVersionSavedEventDataSchema,
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

export const WORKFLOW_VERSION_SAVED_EVENT_VERSION = "2026-10-07" as const;
export const RECORD_WORKFLOW_VERSION_SAVED_COMMAND_TYPE =
  "lw.workflow.record_version_saved" as const;

export const workflowVersionSavedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(WORKFLOW_VERSION_SAVED_EVENT_TYPE),
  version: z.literal(WORKFLOW_VERSION_SAVED_EVENT_VERSION),
  data: workflowVersionSavedEventDataSchema,
});
export type WorkflowVersionSavedEvent = z.infer<typeof workflowVersionSavedEventSchema>;
export type WorkflowLifecycleEvent = WorkflowCreatedEvent | WorkflowVersionSavedEvent;

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

const recordWorkflowVersionSavedCommandDataSchema = withCommandEnvelope(
  workflowVersionSavedEventDataSchema,
);
export type RecordWorkflowVersionSavedCommandData = z.infer<
  typeof recordWorkflowVersionSavedCommandDataSchema
>;

/** Records that a Studio graph was saved as a version; one event per version. */
export class RecordWorkflowVersionSavedCommand implements CommandHandler<
  Command<RecordWorkflowVersionSavedCommandData>,
  WorkflowVersionSavedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_WORKFLOW_VERSION_SAVED_COMMAND_TYPE,
    recordWorkflowVersionSavedCommandDataSchema,
    "Record that a workflow version was saved",
  );

  handle(command: Command<RecordWorkflowVersionSavedCommandData>): WorkflowVersionSavedEvent[] {
    const data = stripEnvelope(command.data);
    return [
      EventUtils.createEvent<WorkflowVersionSavedEvent>({
        aggregateType: WORKFLOW_AGGREGATE_TYPE,
        aggregateId: data.workflowId,
        tenantId: createTenantId(command.tenantId),
        type: WORKFLOW_VERSION_SAVED_EVENT_TYPE,
        version: WORKFLOW_VERSION_SAVED_EVENT_VERSION,
        data: { ...data, occurredAt: command.data.occurredAt },
        occurredAt: command.data.occurredAt,
        idempotencyKey: `${command.tenantId}:${data.workflowId}:version_saved:${data.versionId}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordWorkflowVersionSavedCommandData): string {
    return payload.workflowId;
  }
}
