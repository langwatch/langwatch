import type { AVAILABLE_EVALUATORS, EvaluatorTypes } from "@langwatch/evaluator-contract";
import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";
import type { MonitorIdInput, MonitorWithEvaluator } from "@langwatch/monitor-contract";
import type {
  EvaluationTraceEvent,
  EvaluationTraceReadInput,
  EvaluationTraceSpan,
  Span,
  Trace,
} from "@langwatch/trace-contract";

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
export abstract class EvaluationTraceReadPort {
  abstract getTracesWithSpans(
    projectId: string,
    traceIds: string[],
    protections: EvaluationTraceProtections,
    occurredAt?: { from: number; to: number },
    opts?: { full?: boolean; withEditOverlay?: boolean },
  ): Promise<Trace[]>;

  abstract getEvaluationsMultiple(
    projectId: string,
    traceIds: string[],
    protections: EvaluationTraceProtections,
  ): Promise<Record<string, unknown[]>>;

  abstract getTracesWithSpansByThreadIds(
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
export abstract class EvaluationSpanDigestPort {
  abstract format(spans: Span[]): Promise<string>;
}

export type LangevalsEvaluateParams = Readonly<{
  evaluatorType: string;
  data: Record<string, unknown>;
  settings: Record<string, unknown>;
  env: Record<string, string>;
  idempotencyKey?: string;
}>;

/** The evaluator service an installed (non-native) evaluator runs on. */
export abstract class EvaluationLangevalsPort {
  abstract evaluate(params: LangevalsEvaluateParams): Promise<SingleEvaluationResult>;
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
export abstract class EvaluationModelEnvPort {
  abstract resolveForEvaluator(params: {
    evaluatorType: EvaluatorTypes;
    evaluator: (typeof AVAILABLE_EVALUATORS)[EvaluatorTypes];
    projectId: string;
    settings?: Record<string, unknown>;
  }): Promise<Record<string, string>>;
}

/** Runs a customer's own evaluation workflow in the Studio runtime. */
export abstract class EvaluationWorkflowExecutorPort {
  abstract runEvaluationWorkflow(
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
export abstract class EvaluationExecutionTelemetryPort {
  abstract record(input: {
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
export abstract class EvaluationMonitorLookupPort {
  abstract tryGetMonitorById(input: MonitorIdInput): Promise<MonitorWithEvaluator | null>;
}

/**
 * The two trace reads a precondition check makes, narrowed from the contract's
 * `TraceService` for the same reason. `TraceService` satisfies this.
 */
export abstract class EvaluationTraceEvidencePort {
  abstract getEvaluationSpans(input: EvaluationTraceReadInput): Promise<EvaluationTraceSpan[]>;

  abstract getEvaluationEvents(input: EvaluationTraceReadInput): Promise<EvaluationTraceEvent[]>;
}
