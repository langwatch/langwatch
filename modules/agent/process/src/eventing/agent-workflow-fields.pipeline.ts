/**
 * Agent keeps a linked graph's fields from workflow's version_saved and archived facts
 * (§9, plan §7), so agent reads no fields from workflow.
 * Spec: modules/agent/specs/linked-workflow-and-history.feature
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  WORKFLOW_ARCHIVED_EVENT_TYPE,
  WORKFLOW_VERSION_SAVED_EVENT_TYPE,
  workflowArchivedEventDataSchema,
  workflowVersionSavedEventDataSchema,
} from "@langwatch/workflow-contract";

import type { AgentModule } from "../app/agent.app.ts";
import type { AgentRepositories } from "../repositories/agent.repositories.ts";
import type { AgentWorkflowFieldsService } from "../services/agent-workflow-fields.service.ts";

const AGENT_WORKFLOW_FIELDS_PIPELINE_NAME = "agent_workflow_fields" as const;

export type AgentWorkflowFieldsPipeline = StaticPipelineDefinition<never>;

/** One id per recording of a workflow, so a redelivery is skipped; a newer one is not. */
function recordingIdOf(event: {
  type: string;
  tenantId: string;
  aggregateId: unknown;
  occurredAt: number;
}): string {
  return `agent-workflow-fields:${event.type}:${event.tenantId}:${String(event.aggregateId)}:${event.occurredAt}`;
}

export function buildAgentWorkflowFieldsPipeline({
  fields,
}: {
  fields: Pick<AgentWorkflowFieldsService, "record" | "clear">;
}): AgentWorkflowFieldsPipeline {
  return definePipeline({
    name: AGENT_WORKFLOW_FIELDS_PIPELINE_NAME,
    // `global`: agent appends no events of its own here; it only reacts to workflow's.
    aggregate: defineAggregate({ type: "global" }),
  })
    .withEvents([])
    .withPeerSubscriber("workflowVersionSaved", {
      eventType: WORKFLOW_VERSION_SAVED_EVENT_TYPE,
      data: workflowVersionSavedEventDataSchema,
      options: { deduplication: { makeId: recordingIdOf, ttlMs: 60_000 } },
      handle: async ({ projectId, workflowId, fields: saved, occurredAt }) => {
        if (!saved) return;
        await fields.record({
          projectId,
          workflowId,
          fields: { ...saved, recordedAt: occurredAt },
        });
      },
    })
    .withPeerSubscriber("workflowArchived", {
      eventType: WORKFLOW_ARCHIVED_EVENT_TYPE,
      data: workflowArchivedEventDataSchema,
      options: { deduplication: { makeId: recordingIdOf, ttlMs: 60_000 } },
      handle: ({ projectId, workflowId, occurredAt }) =>
        fields.clear({ projectId, workflowId, recordedAt: occurredAt }),
    })
    .build();
}

export const agentWorkflowFieldsEventing = defineEventingModule({
  pipeline: AGENT_WORKFLOW_FIELDS_PIPELINE_NAME,
  build: ({ app }: EventingSetup<AgentRepositories, AgentModule>) => app.workflowFieldsPipeline(),
});
