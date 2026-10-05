/**
 * The monitor application over memory repositories, for a test that wants the
 * real decisions and none of the datastores. An operation the test did not
 * stub refuses by name rather than answering undefined; ports are recording doubles.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type {
  EvaluationApi,
  EvaluatorOwnSettings,
  MonitorPerformanceQuery,
  OnlineEvaluationPerformance,
} from "@langwatch/evaluation-contract";
import {
  EvaluatorNotFoundError,
  evaluatorSchema,
  type Evaluator,
  type EvaluatorApi,
} from "@langwatch/evaluator-contract";
import { ResourceScope } from "@langwatch/process";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowApi } from "@langwatch/workflow-contract";

import { MemoryMonitorRepository } from "../../repositories/memory/memory.monitor.repository.ts";
import type { MonitorRepositories } from "../../repositories/monitor.repositories.ts";
import { MonitorModule } from "../monitor.app.ts";

type MonitorTestSetup = Parameters<typeof MonitorModule.create>[0];

function evaluatorRow(input: {
  id: string;
  projectId: string;
  workflowId?: string | null;
}): Evaluator {
  return evaluatorSchema.parse({
    id: input.id,
    projectId: input.projectId,
    name: "Quality",
    slug: "quality",
    type: "evaluator",
    config: {},
    workflowId: input.workflowId ?? null,
    copiedFromEvaluatorId: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/** The evaluators a project holds, named by id. */
export class FakeMonitorEvaluators {
  readonly archived: { id: string; projectId: string }[] = [];
  #known = new Set<string>();

  constructor(known: readonly string[] = ["evaluator_1"]) {
    this.#known = new Set(known);
  }

  async getById(input: { id: string; projectId: string }): Promise<Evaluator> {
    if (!this.#known.has(input.id)) throw new EvaluatorNotFoundError(input.id);

    return evaluatorRow(input);
  }

  async archive(input: { id: string; projectId: string }): Promise<Evaluator> {
    this.archived.push(input);

    return evaluatorRow(input);
  }
}

/** The settings each evaluator runs with in place of a monitor's parameters, by id. */
export class FakeEvaluatorOwnSettings {
  constructor(private readonly byEvaluator: Record<string, Record<string, unknown>> = {}) {}

  async find(input: { evaluatorId: string }): Promise<EvaluatorOwnSettings> {
    const settings = this.byEvaluator[input.evaluatorId];

    return settings ? { kind: "own", settings } : { kind: "none" };
  }
}

/** The trend, answered from whatever the test seeded. */
export class FakeMonitorPerformance {
  readonly queries: MonitorPerformanceQuery[] = [];

  constructor(private readonly rows: OnlineEvaluationPerformance[] = []) {}

  async getMonitorPerformance(query: MonitorPerformanceQuery) {
    this.queries.push(query);

    return this.rows;
  }
}

/** The evaluator copy and the workflow clean-up, recording what they were asked and answered. */
export class FakeMonitorReplication {
  readonly copies: { evaluatorId: string; sourceProjectId: string; targetProjectId: string }[] = [];
  readonly deletedWorkflows: { workflowId: string; projectId: string }[] = [];

  constructor(private readonly answer: { id: string; workflowId: string | null }) {}

  async copy(input: {
    evaluatorId: string;
    projectId: string;
    sourceProjectId: string;
  }): Promise<Evaluator> {
    this.copies.push({
      evaluatorId: input.evaluatorId,
      sourceProjectId: input.sourceProjectId,
      targetProjectId: input.projectId,
    });

    return evaluatorRow({
      id: this.answer.id,
      projectId: input.projectId,
      workflowId: this.answer.workflowId,
    });
  }

  async deleteUncommitted(input: { workflowId: string; projectId: string }): Promise<void> {
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
    evaluators?: FakeMonitorEvaluators;
    ownSettings?: FakeEvaluatorOwnSettings;
    performance?: FakeMonitorPerformance;
    replication?: FakeMonitorReplication;
    publicBaseUrl?: string;
  }> = {},
): MonitorModule {
  const evaluators = input.evaluators ?? new FakeMonitorEvaluators();
  const ownSettings = input.ownSettings ?? new FakeEvaluatorOwnSettings();
  const performance = input.performance ?? new FakeMonitorPerformance();
  const replication =
    input.replication ?? new FakeMonitorReplication({ id: "evaluator_copy", workflowId: null });

  return MonitorModule.create({
    repositories: input.repositories ?? createMonitorTestRepositories(),
    members: { publicBaseUrl: input.publicBaseUrl ?? "https://app.langwatch.test" },
    dependencies: {
      permissions:
        input.permissions ?? createApiFixture<AuthzApi>({ hasProjectPermission: async () => true }),
      evaluators: createApiFixture<EvaluatorApi>({
        getById: (scope) => evaluators.getById(scope),
        archive: (scope) => evaluators.archive(scope),
        copy: (copy) => replication.copy(copy),
      }),
      evaluation: createApiFixture<EvaluationApi>({
        getMonitorPerformance: (query) => performance.getMonitorPerformance(query),
        findEvaluatorOwnSettings: (query) => ownSettings.find(query),
      }),
      workflows: createApiFixture<WorkflowApi>({
        deleteUncommitted: (reference) => replication.deleteUncommitted(reference),
      }),
    },
    config: undefined,
    resources: new ResourceScope(),
    secrets: createApiFixture<MonitorTestSetup["secrets"]>(),
  });
}
