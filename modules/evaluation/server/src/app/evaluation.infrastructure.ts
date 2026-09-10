import type { AVAILABLE_EVALUATORS, EvaluatorTypes } from "@langwatch/evaluator-contract";
import type {
  ExecuteEvaluationCommand,
  EvaluationExecutionResult,
  ExecuteEvaluationCommandData,
  EvaluationProcessingEvent,
} from "@langwatch/evaluation-contract";
export interface EvaluationInfrastructure {  evaluationCustomEvaluators: EvaluationCustomEvaluators;
  evaluationExecutionTelemetry: EvaluationExecutionTelemetry;
  evaluationInstallEnvironment: EvaluationInstallEnvironment;
  evaluationLangevals: EvaluationLangevals;
  evaluationModelEnv: EvaluationModelEnv;
  evaluationMonitorLookup: EvaluationMonitorLookup;
  evaluationReport: EvaluationReport;
  evaluationRescore: EvaluationRescore;
  evaluationRunAnalytics: EvaluationRunAnalytics;
  evaluationSpanDigest: EvaluationSpanDigest;
  evaluationTraceEvidence: EvaluationTraceEvidence;
  evaluationTraceRead: EvaluationTraceRead;
  evaluationWarmup: EvaluationWarmupProbe;
  evaluationWorkflowExecutor: EvaluationWorkflowExecutor;
}

/**
 * What a viewer of the trace is allowed to see.
 *
 * Declared here in Evaluation's own vocabulary rather than imported from
 * `@langwatch/trace-server`, which a feature server package may not reach. The
 * one caller that matters passes `INTERNAL_PROTECTIONS` — an evaluation reads
 * the FULL content or it scores a redacted placeholder — so the type states the
 * three flags the read path branches on and nothing else.
 */
export type EvaluationTraceProtections = Readonly<{
  canSeeCosts?: boolean | undefined | null;
  canSeeCapturedInput?: boolean | undefined | null;
  canSeeCapturedOutput?: boolean | undefined | null;
}>;

/**
 * The three legacy trace reads an online evaluation makes.
 *
 * The whole `TraceService` is not named because these are the only calls the
 * execution path makes, and it is a ClickHouse read stack in another feature's
 * server package. The signatures are positional because the implementation the
 * process binds is the packaged one, whose shape this must satisfy exactly.
 */
export interface EvaluationTraceRead {
  getTracesWithSpans(
    projectId: string,
    traceIds: string[],
    protections: EvaluationTraceProtections,
    occurredAt?: { from: number; to: number },
    opts?: { full?: boolean; withEditOverlay?: boolean },
  ): Promise<Trace[]>;

  getEvaluationsMultiple(
    projectId: string,
    traceIds: string[],
    protections: EvaluationTraceProtections,
  ): Promise<Record<string, unknown[]>>;

  getTracesWithSpansByThreadIds(
    projectId: string,
    threadIds: string[],
    protections: EvaluationTraceProtections,
    opts?: { full?: boolean; withEditOverlay?: boolean },
  ): Promise<Trace[]>;
}

/**
 * Renders a trace's spans as the digest an evaluator reads for the
 * `formatted_trace` / `formatted_traces` mapping sources.
 *
 * A port rather than a call because the renderer walks the trace read model and
 * lives with it, in `@langwatch/trace-server`.
 */
export interface EvaluationSpanDigest {
  format(spans: Span[]): Promise<string>;
}

export type LangevalsEvaluateParams = Readonly<{
  evaluatorType: string;
  data: Record<string, unknown>;
  settings: Record<string, unknown>;
  env: Record<string, string>;
  idempotencyKey?: string;
}>;

/** The evaluator service an installed (non-native) evaluator runs on. */
export interface EvaluationLangevals {
  evaluate(params: LangevalsEvaluateParams): Promise<SingleEvaluationResult>;
}

/**
 * Resolves the environment an evaluator executes with: the model provider's
 * credentials for the model the settings name, plus whatever the evaluator's
 * own `envVars` declare.
 *
 * A port because the resolution is the MODEL PROVIDER cascade — another
 * feature's server package, and on a managed deployment an Enterprise one.
 * Guessing it would bill a customer's key against a provider they did not
 * choose.
 */
export interface EvaluationModelEnv {
  resolveForEvaluator(params: {
    evaluatorType: EvaluatorTypes;
    evaluator: (typeof AVAILABLE_EVALUATORS)[EvaluatorTypes];
    projectId: string;
    settings?: Record<string, unknown>;
  }): Promise<Record<string, string>>;
}

/** Runs a customer's own evaluation workflow in the Studio runtime. */
export interface EvaluationWorkflowExecutor {
  runEvaluationWorkflow(
    workflowId: string,
    projectId: string,
    inputs: Record<string, string>,
    versionId?: string,
    causalityDepth?: number,
    parentTrace?: { traceId: string; parentSpanId: string },
  ): Promise<{ result: SingleEvaluationResult; status: string }>;
}

/**
 * The two process series an evaluation run reports: how long it took and how it
 * ended.
 *
 * `evaluation_duration_milliseconds` and `evaluation_status_counter` are the
 * names a dashboard already reads, so an implementation must keep them. A
 * process that composes no registry passes nothing and reports nothing, which
 * is a missing series rather than a wrong one.
 */
export interface EvaluationExecutionTelemetry {
  record(input: {
    evaluatorType: string;
    status: "processed" | "skipped" | "error";
    durationMs: number;
  }): void;
}

/**
 * The one monitor read an execution makes: which evaluator this command names.
 *
 * Narrowed from `MonitorService`, which a worker would otherwise have to
 * compose whole — create, replicate, toggle and the evaluator graph behind
 * them — to answer a lookup by id. `MonitorService` satisfies this.
 */
export interface EvaluationMonitorLookup {
  tryGetMonitorById(input: MonitorIdInput): Promise<MonitorWithEvaluator | null>;
}

/**
 * The two trace reads a precondition check makes, narrowed from the contract's
 * `TraceService` for the same reason. `TraceService` satisfies this.
 */
export interface EvaluationTraceEvidence {
  getEvaluationSpans(input: EvaluationTraceReadInput): Promise<EvaluationTraceSpan[]>;

  getEvaluationEvents(input: EvaluationTraceReadInput): Promise<EvaluationTraceEvent[]>;
}

/** The environment variables this install was started with. */
export interface EvaluationInstallEnvironment {
  read(): Readonly<Record<string, string | undefined>>;
}

/** The project's own workflow-backed evaluators, each with its published version. */
export interface EvaluationCustomEvaluators {
  findAll(input: Readonly<{ projectId: string }>): Promise<CustomEvaluator[]>;
}

/** Scores one stored trace with one evaluator, resolving the caller's protections. */
export interface EvaluationRescore {
  runForTrace(input: RunTraceEvaluationInput): Promise<EvaluationRunOutcome>;
}

/**
 * One liveness probe at the evaluator backend. A failed probe is not an error,
 * only a probe that did not warm anything.
 */
export interface EvaluationWarmupProbe {
  probe(input: Readonly<{ projectId: string }>): Promise<void>;
}

/** Product analytics for a completed run. */
export interface EvaluationRunAnalytics {
  evaluationRan(input: Readonly<{ userId: string; projectId: string }>): void;
}

/** The verdict command every reported evaluation travels on. */
export interface EvaluationReport {
  reportEvaluation(data: ReportEvaluationCommandData): Promise<unknown>;
}

/** The existing trace/evaluator engine is injected at the process boundary. */
export interface EvaluationExecution {
  execute(input: ExecuteEvaluationCommand): Promise<EvaluationExecutionResult>;
}

/** Executes Evaluation's external-work intent behind the process boundary. */
export interface EvaluationExecutionIntent {
  execute(input: ExecuteEvaluationCommandData): Promise<EvaluationProcessingEvent[]>;
}

/**
 * Runs external evaluation work and its associated cost write under one
 * durable Evaluation receipt. A redelivery receives the recorded outcome
 * instead of calling an evaluator or creating a second cost row.
 */
export interface EvaluationExecutionReceipt {
  execute(input: {
    tenantId: string;
    evaluationId: string;
    operationKey: string;
    command: ExecuteEvaluationCommand;
    cost: {
      isGuardrail: boolean;
      evaluatorName: string;
      evaluatorId: string;
      traceId: string;
    };
  }): Promise<{
    result: EvaluationExecutionResult;
    costId: string | null;
  }>;
}

export interface ExecuteEvaluationCommandDeps {
  monitors: EvaluationMonitorLookup;
  traces: EvaluationTraceEvidence;
  executionReceipt: EvaluationExecutionReceipt;
  azureSafetyCredentials: EvaluationAzureSafetyCredentials;
  settingsRecovery: EvaluationSettingsRecovery;
  inputsOffload: EvaluationInputsOffload;
}

/** Resolves Evaluation-owned durable input markers at the read boundary. */
export interface EvaluationInputsResolution {
  tryResolve(input: {
    tenantId: string;
    inputs: Record<string, unknown> | null;
  }): Promise<Record<string, unknown> | null>;
}

/**
 * Applies the shared analytics attribute retention policy at the Evaluation
 * projection boundary. Trace owns the current policy implementation.
 */
export interface EvaluationAnalyticsAttributePolicy {
  trim(attributes: Record<string, string>): Record<string, string>;
}

/** Persists the billable cost of a completed Evaluation execution. */
export interface EvaluationCostRecorder {
  recordCost(input: {
    projectId: string;
    isGuardrail: boolean;
    evaluatorName: string;
    evaluatorId: string;
    traceId: string;
    idempotencyKey: string;
    amount: number;
    currency: string;
  }): Promise<string>;
}

/** Stores Evaluation-owned oversized input payloads behind durable infrastructure. */
export interface EvaluationInputStorage {
  store(input: {
    tenantId: string;
    evaluationId: string;
    bytes: Uint8Array;
  }): Promise<{ id: string }>;

  tryRead(input: {
    tenantId: string;
    id: string;
  }): Promise<AsyncIterable<Uint8Array> | null>;
}

/** Applies the operator-controlled payload-offload availability switch. */
export interface EvaluationInputOffloadAvailability {
  isDisabled(): Promise<boolean>;
}

/** Resolves the Azure Safety provider credentials for an Evaluation tenant. */
export interface EvaluationAzureSafetyCredentials {
  tryGetForTenant(input: { tenantId: string }): Promise<Record<string, string> | null>;
}

/** Reads the Evaluation settings-recovery rollout switch. */
export interface EvaluationSettingsRecovery {
  isDisabled(): Promise<boolean>;
}

/** Offloads an Evaluation result's inputs before the event is created. */
export interface EvaluationInputsOffload {
  offload(input: {
    tenantId: string;
    evaluationId: string;
    inputs: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
}

/** Physical retention horizon used to prune ClickHouse partitions safely. */
export interface EvaluationRetentionFloor {
  getFloorMs(input: { table: "evaluation_runs"; tenantId: string }): Promise<number>;
}
