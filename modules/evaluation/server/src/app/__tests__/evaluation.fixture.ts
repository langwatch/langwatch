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
  EvaluationCustomEvaluatorsPort,
  EvaluationInstallEnvironmentPort,
  EvaluationReportPort,
  EvaluationRescorePort,
  EvaluationRunAnalyticsPort,
  EvaluationWarmupPort,
} from "../../ports/evaluation-rescore.port.ts";
import {
  EvaluationExecutionPort,
  EvaluationInputsResolutionPort,
  EvaluationRetentionFloorPort,
  type EvaluationClickHouseClient,
} from "../../ports/evaluation.port.ts";
import { MemoryEvaluationRepositories } from "../../repositories/memory/memory.evaluation.repositories.ts";
import { EvaluationApp, type EvaluationInfrastructure } from "../evaluation.app.ts";

/** The environment a test names, with nothing inherited from the process. */
export class TestEvaluationInstallEnvironment extends EvaluationInstallEnvironmentPort {
  constructor(private readonly environment: Readonly<Record<string, string | undefined>> = {}) {
    super();
  }

  read(): Readonly<Record<string, string | undefined>> {
    return this.environment;
  }
}

export class TestEvaluationCustomEvaluators extends EvaluationCustomEvaluatorsPort {
  readonly calls: { projectId: string }[] = [];

  constructor(private readonly evaluators: CustomEvaluator[] = []) {
    super();
  }

  async findAll(input: Readonly<{ projectId: string }>): Promise<CustomEvaluator[]> {
    this.calls.push({ projectId: input.projectId });

    return this.evaluators;
  }
}

export class TestEvaluationRescore extends EvaluationRescorePort {
  readonly calls: RunTraceEvaluationInput[] = [];

  constructor(private readonly outcome: EvaluationRunOutcome) {
    super();
  }

  async runForTrace(input: RunTraceEvaluationInput): Promise<EvaluationRunOutcome> {
    this.calls.push(input);

    return this.outcome;
  }
}

export class TestEvaluationWarmup extends EvaluationWarmupPort {
  readonly probes: string[] = [];

  constructor(private readonly failing = false) {
    super();
  }

  async probe(input: Readonly<{ projectId: string }>): Promise<void> {
    this.probes.push(input.projectId);
    if (this.failing) throw new Error("evaluator runtime cold");
  }
}

export class TestEvaluationRunAnalytics extends EvaluationRunAnalyticsPort {
  readonly runs: { userId: string; projectId: string }[] = [];

  evaluationRan(input: Readonly<{ userId: string; projectId: string }>): void {
    this.runs.push({ ...input });
  }
}

export class TestEvaluationReport extends EvaluationReportPort {
  readonly reported: ReportEvaluationCommandData[] = [];

  constructor(private readonly failing = false) {
    super();
  }

  async reportEvaluation(data: ReportEvaluationCommandData): Promise<unknown> {
    if (this.failing) throw new Error("queue unavailable");
    this.reported.push(data);

    return undefined;
  }
}

class UnreachableExecution extends EvaluationExecutionPort {
  execute(): never {
    throw new Error("This test composed no evaluator engine.");
  }
}

class UnreachableRetentionFloor extends EvaluationRetentionFloorPort {
  async getFloorMs(): Promise<number> {
    return 0;
  }
}

class PassThroughInputsResolution extends EvaluationInputsResolutionPort {
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
    infrastructure?: Partial<EvaluationInfrastructure>;
    dependencies?: Partial<{
      workflows: WorkflowApi;
      traces: TraceApi;
      modelProviders: ModelProviderApi;
    }>;
  }> = {},
): EvaluationApp {
  return EvaluationApp.create({
    repositories: MemoryEvaluationRepositories.create(),
    infrastructure: createEvaluationTestInfrastructure(input.infrastructure ?? {}),
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
