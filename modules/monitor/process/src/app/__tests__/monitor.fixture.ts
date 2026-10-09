/**
 * The monitor application over memory repositories, for a test that wants the
 * real decisions and none of the datastores. An operation the test did not
 * stub refuses by name rather than answering undefined; ports are recording doubles.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  EvaluatorNotFoundError,
  evaluatorSchema,
  type Evaluator,
  type EvaluatorApi,
} from "@langwatch/evaluator-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
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
  config?: unknown;
}): Evaluator {
  return evaluatorSchema.parse({
    id: input.id,
    projectId: input.projectId,
    name: "Quality",
    slug: "quality",
    type: "evaluator",
    config: input.config ?? {},
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

  #configs: Readonly<Record<string, unknown>>;

  constructor(known: readonly string[] = ["evaluator_1"], configs: Record<string, unknown> = {}) {
    this.#known = new Set(known);
    this.#configs = configs;
  }

  async getById(input: { id: string; projectId: string }): Promise<Evaluator> {
    if (!this.#known.has(input.id)) throw new EvaluatorNotFoundError(input.id);

    return evaluatorRow({ ...input, config: this.#configs[input.id] });
  }

  async findById(input: { id: string; projectId: string }): Promise<Evaluator | undefined> {
    return this.#known.has(input.id) ? this.getById(input) : undefined;
  }

  async archive(input: { id: string; projectId: string }): Promise<Evaluator> {
    this.archived.push(input);

    return evaluatorRow(input);
  }
}

/** The operator's settings-recovery rollback switch, off until a test turns it on or breaks it. */
export class FakeRecoverySwitch {
  recoveryDisabled = false;
  unreadable = false;

  async isEnabled(flagKey: string): Promise<boolean> {
    if (this.unreadable) throw new Error("flag store unreachable");

    return flagKey === "ops_evaluator_settings_recovery_disabled" && this.recoveryDisabled;
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
    recoverySwitch?: FakeRecoverySwitch;
    replication?: FakeMonitorReplication;
    publicBaseUrl?: string;
    /** The project directory; an ordinary project that accepts writes unless a test says not. */
    projects?: ProjectApi;
  }> = {},
): MonitorModule {
  const evaluators = input.evaluators ?? new FakeMonitorEvaluators();
  const recoverySwitch = input.recoverySwitch ?? new FakeRecoverySwitch();
  const replication =
    input.replication ?? new FakeMonitorReplication({ id: "evaluator_copy", workflowId: null });

  return MonitorModule.create({
    repositories: input.repositories ?? createMonitorTestRepositories(),
    config: { publicBaseUrl: input.publicBaseUrl ?? "https://app.langwatch.test" },
    dependencies: {
      permissions:
        input.permissions ?? createApiFixture<AuthzApi>({ hasProjectPermission: async () => true }),
      evaluators: createApiFixture<EvaluatorApi>({
        getById: (scope) => evaluators.getById(scope),
        findById: (scope) => evaluators.findById(scope),
        archive: (scope) => evaluators.archive(scope),
        copy: (copy) => replication.copy(copy),
      }),
      featureFlags: createApiFixture<FeatureFlagApi>({
        isEnabled: (flagKey) => recoverySwitch.isEnabled(flagKey),
      }),
      workflows: createApiFixture<WorkflowApi>({
        deleteUncommitted: (reference) => replication.deleteUncommitted(reference),
      }),
    },
    channels: {
      projects:
        input.projects ??
        createApiFixture<ProjectApi>({ assertAcceptsWrites: async () => void 0 }, "ProjectApi"),
    },
    resources: new ResourceScope(),
    secrets: createApiFixture<MonitorTestSetup["secrets"]>(),
  });
}
