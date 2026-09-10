/**
 * One trace re-scored, and the pipeline the result is reported on, installed over this
 * process's own graph. `evaluations.*` is the evaluator inventory a project can run and the
 * re-score of one trace against one of them.
 */
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import {
  type EvaluationRunOutcome,
  type ReportEvaluationCommandData,
  type RunTraceEvaluationInput,
} from "@langwatch/evaluation-contract";
import {
  evaluationServer,
  EvaluationCustomEvaluators,
  EvaluationExecution,
  EvaluationInputsResolution,
  EvaluationInstallEnvironment,
  EvaluationProcessingProducerAdapter,
  EvaluationReport,
  EvaluationRescore,
  EvaluationRunAnalytics,
  EvaluationWarmupPort,
  type EvaluationClickHouseResolver,
  type EvaluationInfrastructure,
} from "@langwatch/evaluation-server";
import type { EventSourcing } from "@langwatch/eventing";
import {
  ModelProviderApi,
  type ModelProviderApi as ModelProviderApiContract,
} from "@langwatch/model-provider-contract";
import { createApp } from "@langwatch/runtime-composition";
import { TraceApi, type TraceApi as TraceApiContract } from "@langwatch/trace-contract";
import { TraceRetentionFloorService } from "@langwatch/trace-server";
import { WorkflowApi, type WorkflowApi as WorkflowApiContract } from "@langwatch/workflow-contract";

import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import { listCustomEvaluators } from "../../platform/infrastructure/postgres.custom-evaluators.adapter.ts";
import { createEvaluationTrpcRouter } from "./evaluation-trpc.mount.ts";
import type { ComposedEvaluationFeature } from "./evaluation.composition.types.ts";

/** The other features' capabilities the evaluation surface reads. */
export type EvaluationPeers = Readonly<{
  workflows: WorkflowApiContract;
  traces: TraceApiContract;
  /** The gateway a project's Azure Safety credentials are read from. */
  modelProviders: ModelProviderApiContract;
}>;

/** What this process answers the door's questions with. */
export type EvaluationCollaborators = Readonly<{
  /** Scores one stored trace with one evaluator, over the process's ONE evaluator runtime. */
  runTraceEvaluation: (input: RunTraceEvaluationInput) => Promise<EvaluationRunOutcome>;
  /** One liveness probe at the evaluator backend. */
  probeEvaluatorRuntime: (input: Readonly<{ projectId: string }>) => Promise<void>;
  /** Product signal for a completed evaluation run. */
  trackEvaluationRan: (input: Readonly<{ userId: string; projectId: string }>) => void;
  /** The environment this process was started with, for the evaluator-install questions. */
  environment: Readonly<Record<string, string | undefined>>;
}>;

class ApiEvaluationInstallEnvironment extends EvaluationInstallEnvironment {
  constructor(private readonly environment: Readonly<Record<string, string | undefined>>) {
    super();
  }

  read(): Readonly<Record<string, string | undefined>> {
    return this.environment;
  }
}

/**
 * The project's published workflow-backed evaluators. The rows belong to the
 * Workflow table, so this stays a process-level read until the Workflow
 * capability owns the query.
 */
class ApiEvaluationCustomEvaluators extends EvaluationCustomEvaluators {
  constructor(private readonly prisma: ApiTrpcInfrastructure["prisma"]) {
    super();
  }

  async findAll(input: Readonly<{ projectId: string }>) {
    return listCustomEvaluators({ prisma: this.prisma, projectId: input.projectId });
  }
}

class ApiEvaluationRescore extends EvaluationRescore {
  constructor(private readonly run: EvaluationCollaborators["runTraceEvaluation"]) {
    super();
  }

  runForTrace(input: RunTraceEvaluationInput): Promise<EvaluationRunOutcome> {
    return this.run(input);
  }
}

class ApiEvaluationWarmup extends EvaluationWarmupPort {
  constructor(private readonly send: EvaluationCollaborators["probeEvaluatorRuntime"]) {
    super();
  }

  probe(input: Readonly<{ projectId: string }>): Promise<void> {
    return this.send(input);
  }
}

class ApiEvaluationRunAnalytics extends EvaluationRunAnalytics {
  constructor(private readonly track: EvaluationCollaborators["trackEvaluationRan"]) {
    super();
  }

  evaluationRan(input: Readonly<{ userId: string; projectId: string }>): void {
    this.track(input);
  }
}

/**
 * The api process runs evaluations through the door's own runtime, not through
 * the durable execution path the worker owns: an execute reaching here is a
 * wiring mistake, and says which process it reached.
 */
class UnavailableEvaluationExecution extends EvaluationExecution {
  constructor(private readonly processName: string) {
    super();
  }

  execute(): Promise<never> {
    return Promise.reject(
      new Error(`${this.processName} composes no evaluator runtime for an evaluation read`),
    );
  }
}

/** Stored inputs reach this process already resolved. */
class PassThroughEvaluationInputs extends EvaluationInputsResolution {
  async tryResolve(input: {
    tenantId: string;
    inputs: Record<string, unknown> | null;
  }): Promise<Record<string, unknown> | null> {
    return input.inputs;
  }
}

class ApiEvaluationReport extends EvaluationReport {
  constructor(private readonly send: (data: ReportEvaluationCommandData) => Promise<unknown>) {
    super();
  }

  reportEvaluation(data: ReportEvaluationCommandData): Promise<unknown> {
    return this.send(data);
  }
}

/** Installs the evaluation surface over this process's own graph. */
export async function installApiEvaluation(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: EvaluationPeers;
  collaborators: EvaluationCollaborators;
  /** Names this process on the pipeline it registers. */
  processName: string;
  /** The producer-only eventing runtime the pipeline is registered on. */
  eventing: EventSourcing;
  /**
   * The SAME routed ClickHouse the charted reads and the run history use, as
   * the two calls Evaluation makes of it. The driver's own client meets this
   * structural one at the root, where the connection is opened.
   */
  resolveClickHouse: EvaluationClickHouseResolver;
  /** The project cascade the evaluation retention floor is bounded by. */
  dataRetention: DataRetentionApi;
}): Promise<ComposedEvaluationFeature> {
  const { prisma } = options.infrastructure;
  const { workflows, traces, modelProviders } = options.peers;
  const reportEvaluation = registerReportEvaluation(options);

  const infrastructure: EvaluationInfrastructure = {
    resolveClickHouse: options.resolveClickHouse,
    retentionFloor: TraceRetentionFloorService.create(options.dataRetention),
    execution: new UnavailableEvaluationExecution(options.processName),
    inputResolution: new PassThroughEvaluationInputs(),
    environment: new ApiEvaluationInstallEnvironment(options.collaborators.environment),
    customEvaluators: new ApiEvaluationCustomEvaluators(prisma),
    rescore: new ApiEvaluationRescore(options.collaborators.runTraceEvaluation),
    warmup: new ApiEvaluationWarmup(options.collaborators.probeEvaluatorRuntime),
    analytics: new ApiEvaluationRunAnalytics(options.collaborators.trackEvaluationRan),
    report: new ApiEvaluationReport(reportEvaluation),
  };

  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", { prisma })
    .withInfrastructure(infrastructure)
    .withProvided(WorkflowApi, workflows)
    .withProvided(TraceApi, traces)
    .withProvided(ModelProviderApi, modelProviders)
    .withModule(evaluationServer)
    .boot({ role: "api" });

  const app = runtime.module(evaluationServer).provided;

  return {
    routers: (mount) => ({ evaluations: createEvaluationTrpcRouter(mount.runtime) }),
    app,
    reportEvaluation,
  };
}

/**
 * Registers the `evaluation_processing` pipeline as a PRODUCER and hands back its
 * `reportEvaluation` sender.
 */
function registerReportEvaluation(input: {
  eventing: EventSourcing;
  processName: string;
}): (data: ReportEvaluationCommandData) => Promise<unknown> {
  const registered = input.eventing.register(
    EvaluationProcessingProducerAdapter.createPipeline({ processName: input.processName }),
  );
  const sender = (registered.commands as Record<string, unknown>).reportEvaluation;

  if (!isSender(sender)) {
    throw new Error(
      'The evaluation_processing registration produced no "reportEvaluation" command sender; the pipeline was registered incompletely.',
    );
  }

  return (data) => sender.send(data);
}

/** The one shape a command dispatcher has, checked rather than asserted. */
type CommandSender = { send(data: unknown): Promise<unknown> };
const isSender = (value: unknown): value is CommandSender =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as CommandSender).send === "function";
