/**
 * Evaluator archives the evaluators a workflow backed from its own side once workflow records
 * the archive, and records each as deleted for monitor (§9, plan §7).
 * Spec: modules/evaluator/specs/evaluator-deleted-fact.feature
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
  workflowArchivedEventDataSchema,
} from "@langwatch/workflow-contract";

import type { EvaluatorModule } from "../app/evaluator.app.ts";
import type { EvaluatorRepositories } from "../repositories/evaluator.repositories.ts";
import type { EvaluatorWorkflowArchiveService } from "../services/evaluator-workflow-archive.service.ts";

const EVALUATOR_WORKFLOW_ARCHIVE_CASCADE_PIPELINE_NAME =
  "evaluator_workflow_archive_cascade" as const;

const archivedAtOf = workflowArchivedEventDataSchema.pick({ occurredAt: true });

export type EvaluatorWorkflowArchiveCascadePipeline = StaticPipelineDefinition<never>;

export function buildEvaluatorWorkflowArchiveCascadePipeline({
  evaluators,
}: {
  evaluators: Pick<EvaluatorWorkflowArchiveService, "archiveForWorkflow">;
}): EvaluatorWorkflowArchiveCascadePipeline {
  return (
    definePipeline({
      name: EVALUATOR_WORKFLOW_ARCHIVE_CASCADE_PIPELINE_NAME,
      // `global`: evaluator appends no events of its own here; it only reacts to workflow's.
      aggregate: defineAggregate({ type: "global" }),
    })
      .withEvents([])
      // Only live evaluators are archived, so a redelivery archives and records nothing.
      .withPeerSubscriber("evaluatorWorkflowArchived", {
        eventType: WORKFLOW_ARCHIVED_EVENT_TYPE,
        data: workflowArchivedEventDataSchema,
        options: {
          deduplication: {
            makeId: (event) =>
              `evaluator-workflow-archived:${event.tenantId}:${String(event.aggregateId)}:${archivedAtOf.parse(event.data).occurredAt}`,
            ttlMs: 60_000,
          },
        },
        handle: ({ projectId, workflowId }) =>
          evaluators.archiveForWorkflow({ projectId, workflowId }),
      })
      .build()
  );
}

export const evaluatorWorkflowArchiveCascadeEventing = defineEventingModule({
  pipeline: EVALUATOR_WORKFLOW_ARCHIVE_CASCADE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<EvaluatorRepositories, EvaluatorModule>) =>
    app.workflowArchiveCascadePipeline(),
});
