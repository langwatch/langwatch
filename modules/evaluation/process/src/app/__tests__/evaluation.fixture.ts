import type { AnalyticsApi } from "@langwatch/analytics-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { AutomationApi } from "@langwatch/automation-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type {
  CustomEvaluator,
  EvaluationRunOutcome,
  EvaluationServerConfig,
  ReportEvaluationCommandData,
  RunTraceEvaluationInput,
} from "@langwatch/evaluation-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { withMemoryRepositories } from "@langwatch/kernel";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import type { TraceApi } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";

import type {
  EvaluationCustomEvaluators,
  EvaluationInstallEnvironment,
  EvaluationReport,
  EvaluationRescore,
  EvaluationRunAnalytics,
  EvaluationWarmupProbe,
} from "../../app/evaluation.members.ts";
import { MemoryLangevalsChannel } from "../../channels/memory/memory.langevals.channel.ts";
import { evaluationServer } from "../../evaluation.server.ts";
import type { EvaluationRepositories } from "../../repositories/evaluation.repositories.ts";
import { MemoryEvaluationRepositories } from "../../repositories/memory/memory.evaluation.repositories.ts";
import { EvaluationEventingService } from "../../services/evaluation-eventing.service.ts";
import { EvaluationRunProjectionService } from "../../services/evaluation-run-projection.service.ts";
import { LangevalsClusteringService } from "../../services/langevals-clustering.service.ts";
import { EvaluationApp, type EvaluationInfrastructure } from "../evaluation.app.ts";
import type {
  EvaluationExecution,
  EvaluationInputsResolution,
  EvaluationRetentionFloor,
} from "../evaluation.members.ts";

/** The environment a test names, with nothing inherited from the process. */
export class TestEvaluationInstallEnvironment implements EvaluationInstallEnvironment {
  constructor(private readonly environment: Readonly<Record<string, string | undefined>> = {}) {}

  read(): Readonly<Record<string, string | undefined>> {
    return this.environment;
  }
}

export class TestEvaluationCustomEvaluators implements EvaluationCustomEvaluators {
  readonly calls: { projectId: string }[] = [];

  constructor(private readonly evaluators: CustomEvaluator[] = []) {}

  async findAll(input: Readonly<{ projectId: string }>): Promise<CustomEvaluator[]> {
    this.calls.push({ projectId: input.projectId });

    return this.evaluators;
  }
}

export class TestEvaluationRescore implements EvaluationRescore {
  readonly calls: RunTraceEvaluationInput[] = [];

  constructor(private readonly outcome: EvaluationRunOutcome) {}

  async runForTrace(input: RunTraceEvaluationInput): Promise<EvaluationRunOutcome> {
    this.calls.push(input);

    return this.outcome;
  }
}

export class TestEvaluationWarmup implements EvaluationWarmupProbe {
  readonly probes: string[] = [];

  constructor(private readonly failing = false) {}

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

  constructor(private readonly failing = false) {}

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
    repositories?: EvaluationRepositories;
    dependencies?: Partial<{
      workflows: WorkflowApi;
      traces: TraceApi;
      modelProviders: ModelProviderApi;
      retention: DataRetentionApi;
      featureFlags: FeatureFlagApi;
      evaluators: EvaluatorApi;
      monitors: MonitorApi;
      automations: AutomationApi;
      analytics: AnalyticsApi;
    }>;
    clustering?: LangevalsClusteringService;
  }> = {},
): EvaluationApp {
  const repositories = input.repositories ?? MemoryEvaluationRepositories.create();

  return EvaluationApp.fromInfrastructure({
    infrastructure: createEvaluationTestInfrastructure(input.members ?? {}),
    repositories,
    dependencies: {
      workflows: input.dependencies?.workflows ?? createApiFixture<WorkflowApi>(),
      traces: input.dependencies?.traces ?? createApiFixture<TraceApi>(),
      modelProviders:
        input.dependencies?.modelProviders ??
        createApiFixture<ModelProviderApi>({ getExecutionProviders: async () => ({}) }),
      retention: input.dependencies?.retention ?? createApiFixture<DataRetentionApi>(),
      featureFlags: input.dependencies?.featureFlags ?? createApiFixture<FeatureFlagApi>(),
      evaluators: input.dependencies?.evaluators ?? createApiFixture<EvaluatorApi>(),
      monitors: input.dependencies?.monitors ?? createApiFixture<MonitorApi>(),
      automations: input.dependencies?.automations ?? createApiFixture<AutomationApi>(),
      analytics: input.dependencies?.analytics ?? createApiFixture<AnalyticsApi>(),
    },
    clustering:
      input.clustering ??
      LangevalsClusteringService.create({
        endpoint: undefined,
        langevals: MemoryLangevalsChannel.create(),
      }),
    executionIntent: {
      execute: () => Promise.reject(new Error("this test composed no evaluation execution intent")),
    },
    eventing: EvaluationEventingService.create({
      runs: EvaluationRunProjectionService.create({
        repository: repositories.runs,
        retentionFloor: { getFloorMs: async () => 0 },
      }),
      analytics: createApiFixture<AnalyticsApi>(),
      analyticsFoldCache: repositories.analyticsFoldCache,
      defaultRetentionDays: () => 30,
    }),
  });
}

const memoryEvaluation = withMemoryRepositories(evaluationServer);

/** `createApp` composes no secrets chain: the install gets a scope answering every handle unset. */
export const installableEvaluation: typeof memoryEvaluation = {
  ...memoryEvaluation,
  install: (args) =>
    memoryEvaluation.install({
      ...args,
      secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    }),
};

/** The parsed config an installation test hands the module: main's defaults, no endpoint. */
export const EVALUATION_TEST_CONFIG: EvaluationServerConfig = {
  langevalsEndpoint: undefined,
  stagingThresholdBytes: undefined,
  stagingTtlSeconds: 600,
  evaluationMaxPayloadBytes: 16_000_000,
  topicClusteringMaxPayloadBytes: 180_000_000,
  azureContentSafetyEndpoint: undefined,
  enablePresidio: undefined,
  enableLingua: undefined,
};
