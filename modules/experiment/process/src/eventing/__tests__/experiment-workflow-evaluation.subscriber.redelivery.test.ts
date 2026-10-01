import { createTenantId } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { MemoryExperimentRunFoldRepository } from "../../repositories/memory/memory.experiment-run-fold.repository.ts";
import type {
  ExecutionDataServices,
  ExperimentWorkflowDsl,
} from "../../services/experiment-execution-data.service.ts";
import { WorkflowEvaluationService } from "../../services/experiment-workflow-evaluation.service.ts";
import { workflowEvaluationRequestedEventSchema } from "../experiment-run-events.process.ts";
import { ExperimentRunProgressFoldProjection } from "../experiment-run-progress.projection.ts";
import { ExperimentRunProgressStore } from "../experiment-run-progress.store.ts";
import { createWorkflowEvaluationRequestedSubscriber } from "../experiment-workflow-evaluation.subscriber.ts";

const requested = workflowEvaluationRequestedEventSchema.parse({
  id: "evt_1",
  aggregateId: "experiment_1:run_1",
  aggregateType: "experiment_run",
  tenantId: "project_1",
  createdAt: 1_772_539_200_000,
  occurredAt: 1_772_539_200_000,
  type: "lw.experiment_run.workflow_evaluation_requested",
  version: "2026-09-25",
  data: {
    runId: "run_1",
    experimentId: "experiment_1",
    experimentSlug: "evaluate-me",
    projectSlug: "project-one",
    workflowId: "workflow_1",
    workflowVersionId: "version_1",
    total: 3,
  },
});

describe("workflowEvaluationRequested redelivery", () => {
  it("settles the run once when one request is handled twice", async () => {
    const folds = MemoryExperimentRunFoldRepository.create();
    const store = ExperimentRunProgressStore.create({ repository: folds });
    const projection = ExperimentRunProgressFoldProjection.create({ store });
    const context = { tenantId: createTenantId("project_1"), aggregateId: "experiment_1:run_1" };
    await store.store(projection.apply(projection.init(), requested), context);
    const completions: unknown[] = [];
    const subscriber = createWorkflowEvaluationRequestedSubscriber(
      WorkflowEvaluationService.create({
        experiments: { findOrCreateForWorkflow: () => Promise.reject(new Error("not reached")) },
        workflowSource: createApiFixture<ExperimentWorkflowDsl>({}, "workflowSource"),
        services: createApiFixture<ExecutionDataServices>({}, "services"),
        concurrency: 1,
        folds,
        refusals: {},
        requests: {
          requestWorkflowEvaluation: () => Promise.reject(new Error("not reached")),
          startExperimentRun: () => Promise.reject(new Error("not reached")),
          // The progress fold folding the refusal, as the worker does onto the poller's key.
          completeExperimentRun: async (completion) => {
            completions.push(completion);
            const read = await store.get(context.aggregateId);
            if (read.kind === "folded") {
              await store.store(
                { ...read.state, status: "failed", seq: read.state.seq + 1 },
                context,
              );
            }
          },
        },
        baseUrl: "https://app.langwatch.test",
      }),
    );

    await subscriber.handle(requested, context);
    await subscriber.handle(requested, context);

    expect(completions).toHaveLength(1);
  });
});
