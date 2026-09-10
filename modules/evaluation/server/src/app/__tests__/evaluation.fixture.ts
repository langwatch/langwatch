import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type {
  CustomEvaluator,
  EvaluationRunOutcome,
  ReportEvaluationCommandData,
  RunTraceEvaluationInput,
} from "@langwatch/evaluation-contract";
import { ResourceScope } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";

import {
  EvaluationCustomEvaluators,
  EvaluationInstallEnvironment,
  EvaluationReport,
  EvaluationRescore,
  EvaluationRunAnalytics,
  EvaluationWarmupProbe,
} from "../../app/evaluation.members.ts";
import {
  EvaluationExecution,
  EvaluationInputsResolution,
  EvaluationRetentionFloor,
} from "../evaluation.members.ts";
import type { EvaluationClickHouseClient } from "../../repositories/clickhouse/evaluation-clickhouse-client.ts";
import { MemoryEvaluationRepositories } from "../../repositories/memory/memory.evaluation.repositories.ts";
import { EvaluationApp, type EvaluationInfrastructure } from "../evaluation.app.ts";

/** The environment a test names, with nothing inherited from the process. */
export class TestEvaluationInstallEnvironment implements EvaluationInstallEnvironment {
  constructor(private readonly environment: Readonly<Record<string, string | undefined>> = {}) {
  }

  read(): Readonly<Record<string, string | undefined>> {
    return this.environment;
  }
}

export class TestEvaluationCustomEvaluators implements EvaluationCustomEvaluators {
  readonly calls: { projectId: string }[] = [];

  constructor(private readonly evaluators: CustomEvaluator[] = []) {
  }

  async findAll(input: Readonly<{ projectId: string }>): Promise<CustomEvaluator[]> {
    this.calls.push({ projectId: input.projectId });

    return this.evaluators;
  }
}

export class TestEvaluationRescore implements EvaluationRescore {
  readonly calls: RunTraceEvaluationInput[] = [];

  constructor(private readonly outcome: EvaluationRunOutcome) {
  }

  async runForTrace(input: RunTraceEvaluationInput): Promise<EvaluationRunOutcome> {
    this.calls.push(input);

    return this.outcome;
  }
}

export class TestEvaluationWarmup implements EvaluationWarmupProbe {
  readonly probes: string[] = [];

  constructor(private readonly failing = false) {
  }

  async probe(input: Readonly<{ projectId: string }>): Promise<void> {
    this.probes.push(input.projectId);
    if (this.failing) throw new Error("evaluator runtime cold");
  }
}

export class TestEvaluationRunAnalytics implements EvaluationRunAnalytics {
  readonly runs: { userId: string; projectId: string }[] = [];

  evaluationRan(input: Readonly<{ userId: string; projectId: string }>): void {
    this.runs.push({ ...input });
  }
}

export class TestEvaluationReport implements EvaluationReport {
  readonly reported: ReportEvaluationCommandData[] = [];

  constructor(private readonly failing = false) {
  }

  async reportEvaluation(data: ReportEvaluationCommandData): Promise<unknown> {
    if (this.failing) throw new Error("queue unavailable");
    this.reported.push(data);

    return undefined;
  }
}

class UnreachableExecution implements EvaluationExecution {
  execute(): never {
    throw new Error("This test composed no evaluator engine.");
  }
}

class UnreachableRetentionFloor implements EvaluationRetentionFloor {
  async getFloorMs(): Promise<number> {
    return 0;
  }
}

class PassThroughInputsResolution implements EvaluationInputsResolution {
  async tryResolve(input: {
    tenantId: string;
    inputs: Record<string, unknown> | null;
  }): Promise<Record<string, unknown> | null> {
    return input.inputs;
  }
}

function unreachableClickHouse(): Promise<EvaluationClickHouseClient> {
  return Promise.reject(new Error("This test composed no ClickHouse connection."));
}

/**
 * The collaborators the public evaluation doors reach. A test that exercises a
 * door names the one it needs; every other one refuses by name rather than
 * answering a fake row.
 */
function unreachable(what: string): () => never {
  return () => {
    throw new Error(`This test composed no ${what}.`);
  };
}

export function createEvaluationTestDoorInfrastructure(): Pick<
  EvaluationInfrastructure,
  "experiments" | "experimentRuns" | "slugs" | "savedEvaluators" | "models" | "ledger" | "runner"
> {
  return {
    experiments: {
      findOrCreate: unreachable("experiment directory"),
      findBySlug: unreachable("experiment directory"),
    },
    experimentRuns: {
      startRun: unreachable("experiment run writer"),
      recordTargetResult: unreachable("experiment run writer"),
      recordEvaluatorResult: unreachable("experiment run writer"),
      completeRun: unreachable("experiment run writer"),
    },
    slugs: {
      findMonitorBySlug: unreachable("monitor directory"),
      findDatasetBySlug: unreachable("dataset directory"),
    },
    savedEvaluators: { resolveForExecution: unreachable("saved evaluator directory") },
    models: { findModelForFeature: async () => null },
    ledger: {
      recordCost: unreachable("cost ledger"),
      recordDatasetRow: unreachable("cost ledger"),
    },
    runner: { runEvaluation: unreachable("evaluator runtime") },
  };
}

export function createEvaluationTestInfrastructure(
  overrides: Partial<EvaluationInfrastructure> = {},
): EvaluationInfrastructure {
  return {
    resolveClickHouse: unreachableClickHouse,
    retentionFloor: new UnreachableRetentionFloor(),
    execution: new UnreachableExecution(),
    inputResolution: new PassThroughInputsResolution(),
    environment: new TestEvaluationInstallEnvironment(),
    customEvaluators: new TestEvaluationCustomEvaluators(),
    rescore: new TestEvaluationRescore({ status: "skipped", details: "" } as EvaluationRunOutcome),
    warmup: new TestEvaluationWarmup(),
    analytics: new TestEvaluationRunAnalytics(),
    report: new TestEvaluationReport(),
    ...createEvaluationTestDoorInfrastructure(),
    ...overrides,
  };
}

export function createEvaluationTestApp(
  input: Readonly<{
    members?: Partial<EvaluationInfrastructure>;
    dependencies?: Partial<{
      workflows: WorkflowApi;
      traces: TraceApi;
      modelProviders: ModelProviderApi;
    }>;
  }> = {},
): EvaluationApp {
  return EvaluationApp.create({
    repositories: MemoryEvaluationRepositories.create(),
    members: createEvaluationTestInfrastructure(input.members ?? {}),
    dependencies: {
      workflows: input.dependencies?.workflows ?? createApiFixture<WorkflowApi>(),
      traces: input.dependencies?.traces ?? createApiFixture<TraceApi>(),
      modelProviders:
        input.dependencies?.modelProviders ??
        createApiFixture<ModelProviderApi>({ getExecutionProviders: async () => ({}) }),
    },
    config: void 0,
    resources: new ResourceScope(),
  });
}
