import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { WorkflowModule } from "../app/workflow.app.ts";
import type { WorkflowRepositories } from "../repositories/workflow-repositories.registry.ts";
import {
  RecordWorkflowCreatedCommand,
  type RecordWorkflowCreatedCommandData,
  RecordWorkflowVersionSavedCommand,
  type RecordWorkflowVersionSavedCommandData,
  WORKFLOW_AGGREGATE_TYPE,
  WORKFLOW_LIFECYCLE_PIPELINE_NAME,
  type WorkflowLifecycleEvent,
  workflowCreatedEventSchema,
  workflowVersionSavedEventSchema,
} from "./workflow-lifecycle.commands.ts";

export type WorkflowLifecyclePipeline = StaticPipelineDefinition<
  WorkflowLifecycleEvent,
  Record<string, Projection>,
  | { name: "recordWorkflowCreated"; payload: RecordWorkflowCreatedCommandData }
  | { name: "recordWorkflowVersionSaved"; payload: RecordWorkflowVersionSavedCommandData }
>;

/** The api sends the commands; peers (nurturing, agent) react from their own side (§9). */
export function buildWorkflowLifecyclePipeline(): WorkflowLifecyclePipeline {
  return definePipeline({
    name: WORKFLOW_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: WORKFLOW_AGGREGATE_TYPE }),
  })
    .withEvents([workflowCreatedEventSchema, workflowVersionSavedEventSchema])
    .withCommand("recordWorkflowCreated", RecordWorkflowCreatedCommand)
    .withCommand("recordWorkflowVersionSaved", RecordWorkflowVersionSavedCommand)
    .build();
}

export const workflowLifecycleEventing = defineEventingModule({
  pipeline: WORKFLOW_LIFECYCLE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<WorkflowRepositories, WorkflowModule>) => app.lifecyclePipeline(),
  connect: ({ app, commands }) => app.connectLifecycleCommands(commands),
});
