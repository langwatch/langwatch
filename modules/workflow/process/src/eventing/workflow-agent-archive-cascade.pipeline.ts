/**
 * Workflow archives an agent's graph from its own side once agent records the archive
 * (§9, plan §7), so agent holds no workflow peer for it.
 * Spec: modules/workflow/specs/workflow-service.feature
 */
import { AGENT_ARCHIVED_EVENT_TYPE, agentArchivedEventDataSchema } from "@langwatch/agent-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { WorkflowModule } from "../app/workflow.app.ts";
import type { WorkflowRepositories } from "../repositories/workflow-repositories.registry.ts";
import type { WorkflowService } from "../services/workflow.service.ts";

const WORKFLOW_AGENT_ARCHIVE_CASCADE_PIPELINE_NAME = "workflow_agent_archive_cascade" as const;

export type WorkflowAgentArchiveCascadePipeline = StaticPipelineDefinition<never>;

export function buildWorkflowAgentArchiveCascadePipeline({
  workflows,
}: {
  workflows: Pick<WorkflowService, "archiveIfLive">;
}): WorkflowAgentArchiveCascadePipeline {
  return (
    definePipeline({
      name: WORKFLOW_AGENT_ARCHIVE_CASCADE_PIPELINE_NAME,
      // `global`: workflow appends no events of its own here; it only reacts to agent's.
      aggregate: defineAggregate({ type: "global" }),
    })
      .withEvents([])
      // An archived graph is left alone, so a redelivery does nothing.
      .withPeerSubscriber("workflowAgentArchived", {
        eventType: AGENT_ARCHIVED_EVENT_TYPE,
        data: agentArchivedEventDataSchema,
        options: {
          deduplication: {
            makeId: (event) =>
              `workflow-agent-archived:${event.tenantId}:${String(event.aggregateId)}`,
            ttlMs: 60_000,
          },
        },
        handle: async ({ projectId, cascadedWorkflowId }) => {
          if (!cascadedWorkflowId) return;
          await workflows.archiveIfLive({ workflowId: cascadedWorkflowId, projectId });
        },
      })
      .build()
  );
}

export const workflowAgentArchiveCascadeEventing = defineEventingModule({
  pipeline: WORKFLOW_AGENT_ARCHIVE_CASCADE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<WorkflowRepositories, WorkflowModule>) =>
    app.agentArchiveCascadePipeline(),
});
