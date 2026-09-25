import { createApiFixture } from "@langwatch/api-fixture";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import {
  ExperimentRunProgressRepository,
  type ExperimentRunProgressFailure,
  type ExperimentRunProgressState,
} from "../../repositories/experiment-run-progress.repository.ts";
import type {
  ExecutionDataServices,
  ExperimentWorkflowDsl,
} from "../../services/experiment-execution-data.service.ts";
import { WorkflowEvaluationService } from "../../services/experiment-workflow-evaluation.service.ts";
import { workflowEvaluationRequestedEventSchema } from "../experiment-run-events.process.ts";
import { createWorkflowEvaluationRequestedSubscriber } from "../experiment-workflow-evaluation.subscriber.ts";

/** A registered run whose failure moves it on, as the Redis store does. */
class OneRegisteredRun extends ExperimentRunProgressRepository {
  state: ExperimentRunProgressState = {
    runId: "run_1",
    projectId: "project_1",
    experimentSlug: "evaluate-me",
    status: "running",
    progress: 0,
    total: 3,
    startedAt: 0,
    recentEvents: [],
  };
  readonly failures: ExperimentRunProgressFailure[] = [];

  async createRun(): Promise<void> {}
  async updateProgress(): Promise<void> {}
  async addEvent(): Promise<void> {}
  async completeRun(): Promise<void> {}
  async failRun(_runId: string, failure: ExperimentRunProgressFailure): Promise<void> {
    this.failures.push(failure);
    this.state = { ...this.state, status: "failed" };
  }
  async stopRun(): Promise<void> {}
  async findRunState(): Promise<ExperimentRunProgressState | null> {
    return this.state;
  }
  async deleteRun(): Promise<void> {}
}

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
    const progress = new OneRegisteredRun();
    const services = createApiFixture<ExecutionDataServices>({}, "services");
    const subscriber = createWorkflowEvaluationRequestedSubscriber(
      WorkflowEvaluationService.create({
        experiments: { findOrCreateForWorkflow: () => Promise.reject(new Error("not reached")) },
        workflowSource: createApiFixture<ExperimentWorkflowDsl>({}, "workflowSource"),
        services,
        runLoop: {
          ports: null,
          progress,
          services,
          workflows: createApiFixture<WorkflowApi>({}),
          defaultConcurrency: 1,
          startRun: () => Promise.reject(new Error("not reached")),
        },
        requests: { requestWorkflowEvaluation: () => Promise.reject(new Error("not reached")) },
        baseUrl: "https://app.langwatch.test",
      }),
    );
    const context = { tenantId: "project_1", aggregateId: "experiment_1:run_1" };

    await subscriber.handle(requested, context);
    await subscriber.handle(requested, context);

    expect(progress.failures).toHaveLength(1);
  });
});
