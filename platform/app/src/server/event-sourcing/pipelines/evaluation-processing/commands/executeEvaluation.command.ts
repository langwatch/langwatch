import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { extractErrorMessage } from "../../../../../utils/captureError";
import {
  AZURE_SAFETY_NOT_CONFIGURED_MESSAGE,
  isAzureEvaluatorType,
} from "../../../../app-layer/evaluations/azure-safety-env";
import { getAzureSafetyEnvFromProject } from "../../../../app-layer/evaluations/azure-safety-env.server";
import type { EvaluationCostRecorder } from "../../../../app-layer/evaluations/evaluation-cost.recorder";
import type { EvaluationExecutionService } from "../../../../app-layer/evaluations/evaluation-execution.service";
import type { EvaluationExecutionResult } from "../../../../app-layer/evaluations/evaluation-execution.types";
import type { MonitorService } from "../../../../app-layer/monitors/monitor.service";
import type { MonitorWithEvaluator } from "../../../../app-layer/monitors/repositories/monitor.repository";
import {
  buildPreconditionTraceDataFromCommand,
  checkEvaluatorRequiredFields,
  evaluatePreconditions,
  preconditionsNeedEvents,
} from "../../../../evaluations/preconditions";
import type { CheckPreconditions } from "../../../../evaluations/types";
import type { PreconditionTraceData } from "../../../../filters/precondition-matchers";
import type { MappingState } from "../../../../tracer/tracesMapping";
import type { ElasticSearchEvent, Span } from "../../../../tracer/types";
import type { Command, CommandHandler } from "../../../";
import {
  type createTenantId,
  defineCommandSchema,
  EventUtils,
} from "../../../";
import type { ExecuteEvaluationCommandData } from "../schemas/commands";
import { executeEvaluationCommandDataSchema } from "../schemas/commands";
import {
  EVALUATION_REPORTED_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_VERSION_LATEST,
  EXECUTE_EVALUATION_COMMAND_TYPE,
} from "../schemas/constants";
import type {
  EvaluationProcessingEvent,
  EvaluationReportedEvent,
} from "../schemas/events";

const logger = createLogger(
  "langwatch:evaluation-processing:execute-evaluation",
);

/**
 * A failure the customer can resolve themselves (provider disabled, missing
 * credentials, an oversized evaluator payload) rather than one we have to fix.
 *
 * Keyed on `HandledError.fault` — the repo's own classification, mirrored in
 * `services/aigateway/adapters/httpapi/faults.go`.
 *
 * It is deliberately NOT `HandledError.isHandled(error)`: that is the whole
 * base class, which also covers `EvaluatorExecutionError` (`fault: "platform"`,
 * raised when langevals times out, is unreachable, or returns 5xx).
 * Downgrading those would hide an outage behind a benign skip.
 * `fault: "provider"` likewise stays an error — a third-party outage is not
 * something the customer can act on.
 *
 * Know the failure mode before adding an error type under `executeForTrace`:
 * `fault` **defaults to `"customer"`** (`HandledError`), so this predicate is
 * opt-out, not opt-in. An error class whose author never thought about
 * classification lands on the skip path and stops producing error telemetry.
 * That is a deliberate trade — the alternative, a hand-kept allowlist, goes
 * stale silently in the other direction — but it means any new
 * `HandledError` on this path that represents *our* failure has to declare
 * `fault: "platform"` explicitly. The base class says as much for 5xx-ish
 * errors; this call site is what makes ignoring it expensive.
 */
function isCustomerFixable(error: unknown): error is HandledError {
  return HandledError.isHandled(error) && error.fault === "customer";
}

export interface ExecuteEvaluationCommandDeps {
  monitors: MonitorService;
  spanStorage: {
    getSpansByTraceId(params: {
      tenantId: string;
      traceId: string;
      occurredAtMs?: number;
    }): Promise<Span[]>;
  };
  traceEvents: {
    getEventsByTraceId(params: {
      tenantId: string;
      traceId: string;
    }): Promise<ElasticSearchEvent[]>;
  };
  evaluationExecution: EvaluationExecutionService;
  costRecorder: EvaluationCostRecorder;
  /**
   * Resolves Azure Content Safety credentials from the per-project
   * `azure_safety` model provider. Returns null when no credentials are
   * configured — the command then emits a "skipped" status instead of
   * running the evaluator. Injected for testability.
   */
  azureSafetyEnvResolver?: (
    projectId: string,
  ) => Promise<Record<string, string> | null>;
  /**
   * Offloads oversized evaluator inputs to durable object storage before the
   * event is built, so `event_log.EventPayload` and the fold stay bounded
   * (ADR-040). Returns the inputs unchanged (inline) or a stored-object
   * marker. Flag-gated and fail-open at the composition root; absent here
   * means today's behavior (inputs flow inline; the repository belt-and-braces
   * cap is the only bound).
   */
  offloadInputs?: (args: {
    projectId: string;
    evaluationId: string;
    inputs: Record<string, unknown> | null;
  }) => Promise<Record<string, unknown> | null>;
}

const SCHEMA = defineCommandSchema(
  EXECUTE_EVALUATION_COMMAND_TYPE,
  executeEvaluationCommandDataSchema,
  "Command to execute a single evaluation",
);

/**
 * 1a. Azure Safety BYOK gate — hard cutover to per-project credentials. If
 * the monitor uses an Azure evaluator and the project has no azure_safety
 * provider configured, returns the skip message so the caller can emit a
 * clear configure message the customer can self-serve from the UI. Returns
 * null when the gate does not apply or the project is configured.
 */
async function resolveAzureSafetyGateSkip(args: {
  deps: ExecuteEvaluationCommandDeps;
  monitor: MonitorWithEvaluator;
  tenantId: ReturnType<typeof createTenantId>;
  evaluatorId: string;
}): Promise<string | null> {
  if (!isAzureEvaluatorType(args.monitor.checkType)) return null;
  const azureEnvResolver =
    args.deps.azureSafetyEnvResolver ?? getAzureSafetyEnvFromProject;
  const azureEnv = await azureEnvResolver(args.tenantId);
  if (azureEnv) return null;
  logger.warn(
    {
      tenantId: args.tenantId,
      evaluatorId: args.evaluatorId,
      evaluatorType: args.monitor.checkType,
    },
    "Azure Safety provider not configured — skipping evaluation",
  );
  return AZURE_SAFETY_NOT_CONFIGURED_MESSAGE;
}

/**
 * 3. Read spans from CH, check evaluator required fields, then user-configured
 * preconditions. Fetches events on demand only if a precondition references
 * event fields.
 */
async function checkEvaluationPreconditions(args: {
  deps: ExecuteEvaluationCommandDeps;
  tenantId: ReturnType<typeof createTenantId>;
  data: ExecuteEvaluationCommandData;
  monitor: MonitorWithEvaluator;
}): Promise<boolean> {
  // Pass the event's occurredAt so the span read can prune stored_spans to the
  // trace's weekly partition instead of cold-scanning every partition on S3
  // (the read falls back to an unconstrained scan if the window misses).
  const spans = await args.deps.spanStorage.getSpansByTraceId({
    tenantId: args.tenantId,
    traceId: args.data.traceId,
    occurredAtMs: args.data.occurredAt,
  });

  const requiredFieldsMet = checkEvaluatorRequiredFields({
    evaluatorType: args.monitor.checkType,
    spans,
  });
  if (!requiredFieldsMet) {
    logger.debug(
      {
        tenantId: args.tenantId,
        evaluatorId: args.data.evaluatorId,
        traceId: args.data.traceId,
      },
      "Evaluator required fields not met — skipping evaluation",
    );
    return false;
  }

  const preconditions = (args.monitor.preconditions ??
    []) as CheckPreconditions;

  let events: PreconditionTraceData["events"] = null;
  if (preconditionsNeedEvents(preconditions)) {
    const traceEvents = await args.deps.traceEvents.getEventsByTraceId({
      tenantId: args.tenantId,
      traceId: args.data.traceId,
    });
    events = traceEvents.map((e) => ({
      event_type: e.event_type,
      metrics: e.metrics ?? [],
      event_details: e.event_details ?? [],
    }));
  }

  const traceData = buildPreconditionTraceDataFromCommand({
    data: args.data,
    spans,
    events,
  });
  const preconditionsMet = evaluatePreconditions({ traceData, preconditions });

  if (!preconditionsMet) {
    logger.debug(
      {
        tenantId: args.tenantId,
        evaluatorId: args.data.evaluatorId,
        traceId: args.data.traceId,
      },
      "Preconditions not met — skipping evaluation",
    );
    return false;
  }

  return true;
}

/** 1. Fetch monitor via service. Reports a "skipped" event itself when the
 *  monitor is missing, so the caller only needs to check which case it got. */
async function resolveMonitorOrReportMissing(args: {
  deps: ExecuteEvaluationCommandDeps;
  tenantId: ReturnType<typeof createTenantId>;
  data: ExecuteEvaluationCommandData;
}): Promise<
  { monitor: MonitorWithEvaluator } | { events: EvaluationProcessingEvent[] }
> {
  const monitor = await args.deps.monitors.getMonitorById({
    projectId: args.tenantId,
    monitorId: args.data.evaluatorId,
  });
  if (monitor) return { monitor };
  logger.warn(
    { tenantId: args.tenantId, evaluatorId: args.data.evaluatorId },
    "Monitor not found — skipping evaluation",
  );
  const events = await emitReported({
    data: args.data,
    tenantId: args.tenantId,
    result: { status: "skipped", details: "Monitor not found" },
  });
  return { events };
}

/**
 * 4. Run evaluation via app-layer service, then either drop a non-evaluatable
 * trace with no event, or record cost and emit the single reported event.
 */
async function runEvaluationAndEmit(args: {
  deps: ExecuteEvaluationCommandDeps;
  tenantId: ReturnType<typeof createTenantId>;
  data: ExecuteEvaluationCommandData;
  monitor: MonitorWithEvaluator;
  settings: unknown;
  workflowId: string | null | undefined;
}): Promise<EvaluationProcessingEvent[]> {
  const { deps, tenantId, data, monitor, settings, workflowId } = args;
  const result = await deps.evaluationExecution.executeForTrace({
    projectId: tenantId,
    traceId: data.traceId,
    evaluatorType: data.evaluatorType,
    settings: settings as Record<string, any>,
    mappings: monitor.mappings as MappingState | null,
    level: monitor.level as "trace" | "thread",
    workflowId,
  });

  // A trace the service could not evaluate (no thread_id for a thread-based
  // monitor, errored trace with no I/O, etc.) comes back as "skipped". Drop
  // it with no event, like an unmet precondition: a skipped run has no
  // score to fold, and a bulk re-evaluation over non-evaluatable traces
  // would otherwise emit thousands of results, each paying the heavy
  // evaluation-projection read. Config skips (monitor not found, provider
  // not configured) are emitted earlier via their own path — or, when the
  // failure is thrown from inside execution, by the customer-fault branch
  // in the catch below — and still surface in the UI.
  if (result.status === "skipped") {
    logger.debug(
      {
        tenantId,
        evaluatorId: data.evaluatorId,
        traceId: data.traceId,
        details: result.details,
      },
      "Trace not evaluatable — skipping with no result event",
    );
    return [];
  }

  const costId = await recordEvaluationCostIfProcessed({
    deps,
    tenantId,
    data,
    result,
  });

  // 6. Emit single reported event — fold projection persists to CH.
  return await emitReported({
    data,
    tenantId,
    result: buildProcessedEvaluationResult({ result, costId }),
    offloadInputs: deps.offloadInputs,
  });
}

function resolveEvaluatorSettings(monitor: MonitorWithEvaluator) {
  return monitor.evaluator?.config
    ? ((monitor.evaluator.config as Record<string, any>).settings ??
        monitor.parameters)
    : monitor.parameters;
}

/** 5. Record cost via service — only for a processed result that carries one. */
async function recordEvaluationCostIfProcessed(args: {
  deps: ExecuteEvaluationCommandDeps;
  tenantId: ReturnType<typeof createTenantId>;
  data: ExecuteEvaluationCommandData;
  result: EvaluationExecutionResult;
}): Promise<string | null> {
  if (args.result.status !== "processed" || !args.result.cost) return null;
  return args.deps.costRecorder.recordCost({
    projectId: args.tenantId,
    isGuardrail: !!args.data.isGuardrail,
    evaluatorName: args.data.evaluatorName ?? args.data.evaluatorType,
    evaluatorId: args.data.evaluatorId,
    traceId: args.data.traceId,
    amount: args.result.cost.amount,
    currency: args.result.cost.currency,
  });
}

/**
 * 6. Shape the emitted result. For error results, lift `details` into `error`
 * if the service didn't already set it, so the real failure message always
 * lands in the event's error field where the UI reads from.
 */
function buildProcessedEvaluationResult(args: {
  result: EvaluationExecutionResult;
  costId: string | null;
}) {
  const isError = args.result.status === "error";
  const errorField = isError
    ? (args.result.error ?? args.result.details ?? "Evaluator failed")
    : args.result.error;

  return {
    status: args.result.status,
    score: args.result.score,
    passed: args.result.passed,
    label: args.result.label,
    details: isError ? undefined : args.result.details,
    error: errorField,
    errorDetails: args.result.errorDetails ?? null,
    inputs: args.result.inputs ?? null,
    costId: args.costId,
  };
}

/**
 * Customer-fixable errors (see {@link isCustomerFixable}) are skipped, not
 * errored — mirrors the pre-execution config gates. Everything else is an
 * unanticipated failure and is reported as an error event.
 */
async function handleExecutionError(args: {
  deps: ExecuteEvaluationCommandDeps;
  tenantId: ReturnType<typeof createTenantId>;
  data: ExecuteEvaluationCommandData;
  error: unknown;
}): Promise<EvaluationProcessingEvent[]> {
  const { tenantId, data, error } = args;

  if (isCustomerFixable(error)) {
    logger.info(
      {
        // `meta` first so the fixed identifiers below always win: `meta`
        // is free-form per subclass and can itself carry a `traceId`.
        ...error.meta,
        code: error.code,
        tenantId,
        evaluationId: data.evaluationId,
        evaluatorId: data.evaluatorId,
        traceId: data.traceId,
        error: error.message,
      },
      // Neutral wording on purpose: this branch also catches oversized
      // payloads and non-evaluatable traces, neither of which is a
      // misconfiguration. `code` in the payload says which it was.
      "Customer-fixable evaluator failure — skipping evaluation",
    );

    return emitReported({
      data,
      tenantId,
      result: {
        status: "skipped",
        details: error.message,
      },
    });
  }

  logger.error(
    {
      tenantId: tenantId,
      evaluationId: data.evaluationId,
      evaluatorId: data.evaluatorId,
      traceId: data.traceId,
      error: error instanceof Error ? error.message : String(error),
    },
    "Evaluation execution failed",
  );

  return emitReported({
    data,
    tenantId,
    result: {
      status: "error",
      error: extractErrorMessage(error),
      errorDetails: error instanceof Error ? (error.stack ?? null) : null,
    },
  });
}

/**
 * Command handler for executing evaluations.
 *
 * Sampling + preconditions + execution -> emits a single EvaluationReportedEvent.
 * Results are persisted to CH via the evaluationRun fold projection.
 * Deduped by traceId + evaluatorId (makeJobId), delayed 30s.
 *
 * Uses constructor DI — instantiate with deps and pass via `.withCommandInstance()`.
 */
export class ExecuteEvaluationCommand
  implements
    CommandHandler<
      Command<ExecuteEvaluationCommandData>,
      EvaluationProcessingEvent
    >
{
  static readonly schema = SCHEMA;

  constructor(private readonly deps: ExecuteEvaluationCommandDeps) {}

  static getAggregateId(payload: ExecuteEvaluationCommandData): string {
    return payload.evaluationId;
  }

  static getSpanAttributes(
    payload: ExecuteEvaluationCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.evaluation.id": payload.evaluationId,
      "payload.evaluator.id": payload.evaluatorId,
      "payload.evaluator.type": payload.evaluatorType,
      "payload.trace.id": payload.traceId,
    };
  }

  static makeJobId(payload: ExecuteEvaluationCommandData): string {
    if (
      payload.threadIdleTimeout &&
      payload.threadIdleTimeout > 0 &&
      payload.threadId
    ) {
      return `exec:${payload.tenantId}:thread:${payload.threadId}:${payload.evaluatorId}`;
    }
    return `exec:${payload.tenantId}:${payload.traceId}:${payload.evaluatorId}`;
  }

  async handle(
    command: Command<ExecuteEvaluationCommandData>,
  ): Promise<EvaluationProcessingEvent[]> {
    const { tenantId, data } = command;

    logger.debug(
      {
        tenantId: tenantId,
        evaluationId: data.evaluationId,
        evaluatorId: data.evaluatorId,
        traceId: data.traceId,
      },
      "Handling execute evaluation command",
    );

    const monitorResolution = await resolveMonitorOrReportMissing({
      deps: this.deps,
      tenantId,
      data,
    });
    if ("events" in monitorResolution) return monitorResolution.events;
    const { monitor } = monitorResolution;

    const azureSkipDetails = await resolveAzureSafetyGateSkip({
      deps: this.deps,
      monitor,
      tenantId,
      evaluatorId: data.evaluatorId,
    });
    if (azureSkipDetails) {
      return emitReported({
        data,
        tenantId,
        result: {
          status: "skipped",
          details: azureSkipDetails,
        },
      });
    }

    // 2. Sampling
    if (Math.random() > monitor.sample) {
      logger.debug(
        {
          tenantId: tenantId,
          evaluatorId: data.evaluatorId,
          sample: monitor.sample,
        },
        "Evaluation excluded by sampling",
      );
      return [];
    }

    const preconditionsMet = await checkEvaluationPreconditions({
      deps: this.deps,
      tenantId,
      data,
      monitor,
    });
    if (!preconditionsMet) {
      return []; // No events — preconditions didn't match
    }

    // 4. Run evaluation via app-layer service
    const settings = resolveEvaluatorSettings(monitor);
    const workflowId =
      monitor.evaluator?.type === "workflow"
        ? monitor.evaluator.workflowId
        : undefined;

    try {
      return await runEvaluationAndEmit({
        deps: this.deps,
        tenantId,
        data,
        monitor,
        settings,
        workflowId,
      });
    } catch (error) {
      return handleExecutionError({ deps: this.deps, tenantId, data, error });
    }
  }
}

async function emitReported({
  data,
  tenantId,
  result,
  offloadInputs,
}: {
  data: ExecuteEvaluationCommandData;
  tenantId: ReturnType<typeof createTenantId>;
  result: {
    status: "processed" | "error" | "skipped";
    score?: number;
    passed?: boolean;
    label?: string;
    details?: string;
    inputs?: Record<string, unknown> | null;
    error?: string;
    errorDetails?: string | null;
    costId?: string | null;
  };
  offloadInputs?: ExecuteEvaluationCommandDeps["offloadInputs"];
}): Promise<EvaluationProcessingEvent[]> {
  // ADR-040: offload oversized inputs to durable object storage BEFORE the
  // event is created, so the S3 PUT precedes the event_log append (matching
  // the PUT-then-row ordering used by stored-objects) and the event carries
  // only the bounded marker. No-op when the hook is absent (flag off) or when
  // there are no inputs.
  const inputs =
    offloadInputs && result.inputs
      ? await offloadInputs({
          projectId: tenantId,
          evaluationId: data.evaluationId,
          inputs: result.inputs,
        })
      : (result.inputs ?? null);

  const event = EventUtils.createEvent<EvaluationReportedEvent>({
    aggregateType: "evaluation",
    aggregateId: data.evaluationId,
    tenantId,
    type: EVALUATION_REPORTED_EVENT_TYPE,
    version: EVALUATION_REPORTED_EVENT_VERSION_LATEST,
    data: {
      evaluationId: data.evaluationId,
      evaluatorId: data.evaluatorId,
      evaluatorType: data.evaluatorType,
      evaluatorName: data.evaluatorName,
      traceId: data.traceId,
      isGuardrail: data.isGuardrail,
      status: result.status,
      score: result.score ?? null,
      passed: result.passed ?? null,
      label: result.label ?? null,
      details: result.details ?? null,
      inputs,
      error: result.error ?? null,
      errorDetails: result.errorDetails ?? null,
      costId: result.costId ?? null,
    },
    occurredAt: data.occurredAt,
    idempotencyKey: `${data.tenantId}:${data.evaluationId}:reported`,
  });

  return [event];
}
