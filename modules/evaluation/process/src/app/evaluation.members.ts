import type {
  ExecuteEvaluationCommand,
  EvaluationExecutionResult,
  ExecuteEvaluationCommandData,
  EvaluationProcessingEvent,
  CustomEvaluator,
  RunTraceEvaluationInput,
  EvaluationRunOutcome,
  ReportEvaluationCommandData,
} from "@langwatch/evaluation-contract";
import type {
  AVAILABLE_EVALUATORS,
  EvaluatorTypes,
  SingleEvaluationResult,
} from "@langwatch/evaluator-contract";
import type { MonitorIdInput, MonitorWithEvaluator } from "@langwatch/monitor-contract";
import type {
  Trace,
  Span,
  EvaluationTraceReadInput,
  EvaluationTraceSpan,
  EvaluationTraceEvent,
} from "@langwatch/trace-contract";
/**
 * Trace view protections for an evaluation read. Declared in Evaluation vocab
 * rather than imported from trace-server (feature packages may not import).
 */
export type EvaluationTraceProtections = Readonly<{
  canSeeCosts?: boolean | undefined | null;
  canSeeCapturedInput?: boolean | undefined | null;
  canSeeCapturedOutput?: boolean | undefined | null;
}>;

/**
 * The three legacy trace reads an online evaluation makes, narrowed from
 * `TraceService` (a ClickHouse read stack in another feature's server
 * package). Positional signatures match the packaged implementation's shape exactly.
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
 * `formatted_trace` / `formatted_traces` mapping sources. A port rather than
 * a call, since the renderer walks the trace read model in `@langwatch/trace-process`.
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
 * Resolves the environment an evaluator executes with: model provider credentials and
 * env vars. A port to avoid billing a customer's key against a provider they didn't choose.
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
 * Reporting interface for evaluation run telemetry: duration and status. Names are
 * already read by dashboard; implementation must keep them stable.
 */
export interface EvaluationExecutionTelemetry {
  record(input: {
    evaluatorType: string;
    status: "processed" | "skipped" | "error";
    durationMs: number;
  }): void;
}

/**
 * The one monitor read an execution makes: which evaluator this command
 * names. Narrowed from `MonitorService`, which a worker would otherwise
 * compose whole — create, replicate, toggle and the evaluator graph — for a lookup by id.
 */
export interface EvaluationMonitorLookup {
  /** Throws `MonitorNotFoundError` when the monitor was deleted after the command was queued. */
  getMonitorById(input: MonitorIdInput): Promise<MonitorWithEvaluator>;
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

/** Stores Evaluation-owned oversized input payloads behind durable members. */
export interface EvaluationInputStorage {
  store(input: {
    tenantId: string;
    evaluationId: string;
    bytes: Uint8Array;
  }): Promise<{ id: string }>;

  tryRead(input: { tenantId: string; id: string }): Promise<AsyncIterable<Uint8Array> | null>;
}

/** Applies the operator-controlled payload-offload availability switch. */
export interface EvaluationInputOffloadAvailability {
  isDisabled(): Promise<boolean>;
}

/** Resolves the Azure Safety provider credentials for an Evaluation tenant. */
export interface EvaluationAzureSafetyCredentials {
  resolveForTenant(input: {
    tenantId: string;
  }): Promise<EvaluationAzureSafetyCredentialsResolution>;
}

/**
 * The tenant's Azure Safety provider credentials, or that none is configured (the evaluation is
 * skipped).
 */
export type EvaluationAzureSafetyCredentialsResolution =
  | Readonly<{ kind: "configured"; credentials: Record<string, string> }>
  | Readonly<{ kind: "unconfigured" }>;

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
