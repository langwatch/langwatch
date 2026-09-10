/**
 * The monitor application over memory repositories, for a test that wants the
 * real decisions and none of the datastores. The peer arrives as an API
 * fixture, so an operation the test did not stub refuses by name rather than
 * answering undefined; the three technical ports are recording doubles.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type {
  MonitorPerformanceQuery,
  OnlineEvaluationPerformance,
} from "@langwatch/evaluation-contract";
import { EvaluatorNotFoundError } from "@langwatch/evaluator-contract";
import { ResourceScope } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import { MonitorEvaluatorPort } from "../../ports/monitor-evaluator.port.ts";
import { MonitorPerformancePort } from "../../ports/monitor-performance.port.ts";
import { MemoryMonitorRepository } from "../../repositories/memory/memory.monitor.repository.ts";
import type { MonitorRepositories } from "../../repositories/monitor.repositories.ts";
import { MonitorApp, type MonitorReplicationReader } from "../monitor.app.ts";

/** The evaluators a project holds, named by id. */
export class FakeMonitorEvaluators extends MonitorEvaluatorPort {
  readonly archived: { id: string; projectId: string }[] = [];
  #known = new Set<string>();

  constructor(known: readonly string[] = ["evaluator_1"]) {
    super();
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
export class FakeMonitorPerformance extends MonitorPerformancePort {
  readonly queries: MonitorPerformanceQuery[] = [];

  constructor(private readonly rows: OnlineEvaluationPerformance[] = []) {
    super();
  }

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
    evaluators?: MonitorEvaluatorPort;
    performance?: MonitorPerformancePort;
    replication?: MonitorReplicationReader;
    generateId?: () => string;
  }> = {},
): MonitorApp {
  return MonitorApp.create({
    repositories: input.repositories ?? createMonitorTestRepositories(),
    dependencies: {
      permissions:
        input.permissions ??
        createApiFixture<AuthzApi>({ hasProjectPermission: async () => true }),
    },
    infrastructure: {
      evaluators: input.evaluators ?? new FakeMonitorEvaluators(),
      performance: input.performance ?? new FakeMonitorPerformance(),
      replication:
        input.replication ?? new FakeMonitorReplication({ id: "evaluator_copy", workflowId: null }),
      generateId: input.generateId ?? (() => "monitor_test"),
    },
    config: void 0,
    resources: new ResourceScope(),
  });
}
