import { z } from "zod";

import {
  fieldSchema,
  studioOptimizerIdSchema,
  studioOptimizerParamsSchema,
  studioWorkflowSchema,
} from "./studio-workflow.ts";
import type { BaseComponent, StudioWorkflow } from "./studio-workflow.ts";

export const studioClientEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("is_alive"), payload: z.record(z.string(), z.never()) }),
  z.object({
    type: z.literal("execute_component"),
    payload: z.object({
      trace_id: z.string(),
      thread_id: z.string().optional(),
      workflow: studioWorkflowSchema,
      node_id: z.string(),
      inputs: z.record(z.string(), z.unknown()),
      origin: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("stop_execution"),
    payload: z.object({
      trace_id: z.string(),
      node_id: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("execute_flow"),
    payload: z.object({
      trace_id: z.string(),
      workflow: studioWorkflowSchema,
      until_node_id: z.string().optional(),
      inputs: z.array(z.record(z.string(), z.unknown())).optional(),
      manual_execution_mode: z.boolean().optional(),
      do_not_trace: z.boolean().optional(),
      run_evaluations: z.boolean().optional(),
      origin: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("execute_evaluation"),
    payload: z.object({
      run_id: z.string(),
      workflow: studioWorkflowSchema,
      workflow_version_id: z.string(),
      evaluate_on: z.enum(["full", "test", "train", "specific"]),
      dataset_entry: z.number().optional(),
      origin: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("execute_optimization"),
    payload: z.object({
      run_id: z.string(),
      workflow: studioWorkflowSchema,
      workflow_version_id: z.string(),
      optimizer: studioOptimizerIdSchema,
      params: studioOptimizerParamsSchema,
    }),
  }),
  z.object({
    type: z.literal("stop_evaluation_execution"),
    payload: z.object({
      workflow: studioWorkflowSchema,
      run_id: z.string(),
    }),
  }),
  z.object({
    type: z.literal("stop_optimization_execution"),
    payload: z.object({
      workflow: studioWorkflowSchema,
      run_id: z.string(),
    }),
  }),
]);

export type StudioClientEvent = z.infer<typeof studioClientEventSchema>;

export type StudioServerEvent =
  | { type: "is_alive_response" }
  | {
      type: "component_state_change";
      payload: {
        component_id: string;
        execution_state: BaseComponent["execution_state"];
      };
    }
  | {
      type: "execution_state_change";
      payload: {
        execution_state: StudioWorkflow["state"]["execution"];
      };
    }
  | {
      type: "evaluation_run_change";
      payload: {
        evaluation_run: StudioWorkflow["state"]["evaluation"];
      };
    }
  | {
      type: "evaluation_state_change";
      payload: {
        evaluation_state: StudioWorkflow["state"]["evaluation"];
      };
    }
  | {
      type: "optimization_state_change";
      payload: {
        optimization_state: StudioWorkflow["state"]["optimization"];
      };
    }
  | { type: "debug"; payload: { message: string } }
  | { type: "error"; payload: { message: string } }
  | { type: "done" };

/** The workflow's own lifecycle facts, apart from its runs, which peers react to (§9). */
export const WORKFLOW_CREATED_EVENT_TYPE = "lw.workflow.created" as const;

/** A workflow was created (not copied), how many the project holds counting it, and when. */
export const workflowCreatedEventDataSchema = z.object({
  workflowId: z.string(),
  projectId: z.string(),
  userId: z.string(),
  workflowCount: z.number().int().nonnegative(),
  occurredAt: z.number().int().nonnegative(),
});
export type WorkflowCreatedEventData = z.infer<typeof workflowCreatedEventDataSchema>;

/** Agent keeps a linked graph's fields from its own side on this fact (§9). */
export const WORKFLOW_VERSION_SAVED_EVENT_TYPE = "lw.workflow.version_saved" as const;

/** The input and output fields a graph's version offers to whatever maps onto it. */
export const workflowMappingFieldsSchema = z.object({
  inputFields: z.array(fieldSchema),
  outputFields: z.array(fieldSchema),
  fieldsResolved: z.boolean(),
});

/**
 * A version of a workflow was saved, restored or recorded again, by whom and when.
 * `fields` is present only while that version is the live workflow's current one.
 */
export const workflowVersionSavedEventDataSchema = z.object({
  workflowId: z.string(),
  projectId: z.string(),
  versionId: z.string(),
  authorId: z.string(),
  fields: workflowMappingFieldsSchema.optional(),
  occurredAt: z.number().int().nonnegative(),
});
export type WorkflowVersionSavedEventData = z.infer<typeof workflowVersionSavedEventDataSchema>;

/** Agent clears a linked graph's fields from its own side on this fact (§9). */
export const WORKFLOW_ARCHIVED_EVENT_TYPE = "lw.workflow.archived" as const;

/** A workflow was archived, and when. */
export const workflowArchivedEventDataSchema = z.object({
  workflowId: z.string(),
  projectId: z.string(),
  occurredAt: z.number().int().nonnegative(),
});
export type WorkflowArchivedEventData = z.infer<typeof workflowArchivedEventDataSchema>;
