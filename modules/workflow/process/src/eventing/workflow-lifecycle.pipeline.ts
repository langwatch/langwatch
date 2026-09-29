import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { WorkflowApp } from "../app/workflow.app.ts";
import type { WorkflowRepositories } from "../repositories/workflow-repositories.registry.ts";
import {
  createWorkflowCreatedNurturingSubscriber,
  type WorkflowCreatedNurturingDeps,
} from "./workflow-created-nurturing.subscriber.ts";
import {
  RecordWorkflowCreatedCommand,
  type RecordWorkflowCreatedCommandData,
} from "./workflow-lifecycle.commands.ts";
import {
  WORKFLOW_AGGREGATE_TYPE,
  WORKFLOW_LIFECYCLE_PIPELINE_NAME,
  type WorkflowLifecycleEvent,
  workflowCreatedEventSchema,
} from "./workflow-lifecycle.events.ts";

export type WorkflowLifecyclePipeline = StaticPipelineDefinition<
  WorkflowLifecycleEvent,
  Record<string, Projection>,
  { name: "recordWorkflowCreated"; payload: RecordWorkflowCreatedCommandData }
>;

/** The api sends the command; only the worker constructs the subscriber that announces it. */
export function buildWorkflowLifecyclePipeline(
  nurturing: WorkflowCreatedNurturingDeps,
): WorkflowLifecyclePipeline {
  return definePipeline({
    name: WORKFLOW_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: WORKFLOW_AGGREGATE_TYPE }),
  })
    .withEvents([workflowCreatedEventSchema])
    .withEventSubscriber(
      "workflowCreatedNurturing",
      createWorkflowCreatedNurturingSubscriber(nurturing),
    )
    .withCommand("recordWorkflowCreated", RecordWorkflowCreatedCommand)
    .build();
}

export const workflowLifecycleEventing = defineEventingModule({
  pipeline: WORKFLOW_LIFECYCLE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<WorkflowRepositories, WorkflowApp>) => app.lifecyclePipeline(),
  connect: ({ app, commands }) => app.connectLifecycleCommands(commands),
});
