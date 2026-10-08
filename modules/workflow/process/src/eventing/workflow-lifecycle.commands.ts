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
  WORKFLOW_ARCHIVED_EVENT_TYPE,
  WORKFLOW_CREATED_EVENT_TYPE,
  WORKFLOW_VERSION_SAVED_EVENT_TYPE,
  workflowArchivedEventDataSchema,
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

export const WORKFLOW_ARCHIVED_EVENT_VERSION = "2026-10-08" as const;
export const RECORD_WORKFLOW_ARCHIVED_COMMAND_TYPE = "lw.workflow.record_archived" as const;

export const workflowArchivedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(WORKFLOW_ARCHIVED_EVENT_TYPE),
  version: z.literal(WORKFLOW_ARCHIVED_EVENT_VERSION),
  data: workflowArchivedEventDataSchema,
});
export type WorkflowArchivedEvent = z.infer<typeof workflowArchivedEventSchema>;
export type WorkflowLifecycleEvent =
  | WorkflowCreatedEvent
  | WorkflowVersionSavedEvent
  | WorkflowArchivedEvent;

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

/**
 * Records a saved version; a version recorded again (a restore, the backfill) is a new
 * event, and only a version sent with the same instant is one event however often sent.
 */
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
        idempotencyKey: `${command.tenantId}:${data.workflowId}:version_saved:${data.versionId}:${command.data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordWorkflowVersionSavedCommandData): string {
    return payload.workflowId;
  }
}

const recordWorkflowArchivedCommandDataSchema = withCommandEnvelope(
  workflowArchivedEventDataSchema,
);
export type RecordWorkflowArchivedCommandData = z.infer<
  typeof recordWorkflowArchivedCommandDataSchema
>;

/** Records that a workflow was archived; an archive sent with the same instant is one event. */
export class RecordWorkflowArchivedCommand implements CommandHandler<
  Command<RecordWorkflowArchivedCommandData>,
  WorkflowArchivedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_WORKFLOW_ARCHIVED_COMMAND_TYPE,
    recordWorkflowArchivedCommandDataSchema,
    "Record that a workflow was archived",
  );

  handle(command: Command<RecordWorkflowArchivedCommandData>): WorkflowArchivedEvent[] {
    const data = stripEnvelope(command.data);
    return [
      EventUtils.createEvent<WorkflowArchivedEvent>({
        aggregateType: WORKFLOW_AGGREGATE_TYPE,
        aggregateId: data.workflowId,
        tenantId: createTenantId(command.tenantId),
        type: WORKFLOW_ARCHIVED_EVENT_TYPE,
        version: WORKFLOW_ARCHIVED_EVENT_VERSION,
        data: { ...data, occurredAt: command.data.occurredAt },
        occurredAt: command.data.occurredAt,
        idempotencyKey: `${command.tenantId}:${data.workflowId}:archived:${command.data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordWorkflowArchivedCommandData): string {
    return payload.workflowId;
  }
}
