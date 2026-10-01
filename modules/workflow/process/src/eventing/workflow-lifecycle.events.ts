import { EventSchema } from "@langwatch/eventing";
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
