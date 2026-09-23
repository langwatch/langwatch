import { createApiFixture } from "@langwatch/api-fixture";
/**
 * The monitor application over memory repositories, for a test that wants the
 * real decisions and none of the datastores. An operation the test did not
 * stub refuses by name rather than answering undefined; ports are recording doubles.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type {
  EvaluationApi,
  MonitorPerformanceQuery,
  OnlineEvaluationPerformance,
} from "@langwatch/evaluation-contract";
import { EvaluatorNotFoundError, type EvaluatorApi } from "@langwatch/evaluator-contract";

import { MemoryMonitorRepository } from "../../repositories/memory/memory.monitor.repository.ts";
import type { MonitorRepositories } from "../../repositories/monitor.repositories.ts";
import {
  type MonitorEvaluator,
  type MonitorPerformance,
  MonitorApp,
  type MonitorReplicationReader,
} from "../monitor.app.ts";

/** The evaluators a project holds, named by id. */
export class FakeMonitorEvaluators implements MonitorEvaluator {
  readonly archived: { id: string; projectId: string }[] = [];
  #known = new Set<string>();

  constructor(known: readonly string[] = ["evaluator_1"]) {
    this.#known = new Set(known);
  }

  async getById(input: { id: string; projectId: string }): Promise<unknown> {
    if (!this.#known.has(input.id)) throw new EvaluatorNotFoundError(input.id);

    return { id: input.id, projectId: input.projectId };
  }

  async archive(input: { id: string; projectId: string }): Promise<unknown> {
    this.archived.push(input);

    return { id: input.id };
  }
}

/** The trend, answered from whatever the test seeded. */
export class FakeMonitorPerformance implements MonitorPerformance {
  readonly queries: MonitorPerformanceQuery[] = [];

  constructor(private readonly rows: OnlineEvaluationPerformance[] = []) {}

  async getMonitorPerformance(query: MonitorPerformanceQuery) {
    this.queries.push(query);

    return this.rows;
  }

  previousPeriodStartMs(range: { projectId: string; startMs: number; endMs: number }): number {
    return range.startMs - (range.endMs - range.startMs);
  }
}

/** The evaluator copy, recording what it was asked and what it answered. */
export class FakeMonitorReplication implements MonitorReplicationReader {
  readonly copies: { evaluatorId: string; sourceProjectId: string; targetProjectId: string }[] = [];
  readonly deletedWorkflows: { workflowId: string; projectId: string }[] = [];

  constructor(private readonly answer: { id: string; workflowId: string | null }) {}

  async copyEvaluatorToProject(input: {
    evaluatorId: string;
    sourceProjectId: string;
    targetProjectId: string;
  }) {
    this.copies.push({
      evaluatorId: input.evaluatorId,
      sourceProjectId: input.sourceProjectId,
      targetProjectId: input.targetProjectId,
    });

    return this.answer;
  }

  async deleteReplicatedWorkflow(input: { workflowId: string; projectId: string }) {
    this.deletedWorkflows.push(input);
  }
}

export function createMonitorTestRepositories(
  repository = MemoryMonitorRepository.create(),
): MonitorRepositories {
  return { monitors: repository };
}

export function createMonitorTestApp(
  input: Readonly<{
    repositories?: MonitorRepositories;
    permissions?: AuthzApi;
    evaluators?: MonitorEvaluator;
    performance?: MonitorPerformance;
    replication?: MonitorReplicationReader;
    generateId?: () => string;
    publicBaseUrl?: string;
  }> = {},
): MonitorApp {
  return MonitorApp.fromInfrastructure({
    repositories: input.repositories ?? createMonitorTestRepositories(),
    dependencies: {
      permissions:
        input.permissions ?? createApiFixture<AuthzApi>({ hasProjectPermission: async () => true }),
      evaluators: createApiFixture<EvaluatorApi>(),
      evaluation: createApiFixture<EvaluationApi>(),
    },
    infrastructure: {
      evaluators: input.evaluators ?? new FakeMonitorEvaluators(),
      performance: input.performance ?? new FakeMonitorPerformance(),
      replication:
        input.replication ?? new FakeMonitorReplication({ id: "evaluator_copy", workflowId: null }),
      generateId: input.generateId ?? (() => "monitor_test"),
      publicBaseUrl: input.publicBaseUrl ?? "https://app.langwatch.test",
    },
  });
}
