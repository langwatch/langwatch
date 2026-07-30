import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import {
  AZURE_SAFETY_NOT_CONFIGURED_MESSAGE,
  isAzureEvaluatorType,
} from "~/server/app-layer/evaluations/azure-safety-env";
import { getAzureSafetyEnvFromProject } from "~/server/app-layer/evaluations/azure-safety-env.server";
import type { EvaluationCostRecorder } from "~/server/app-layer/evaluations/evaluation-cost.recorder";
import type { EvaluationExecutionService } from "~/server/app-layer/evaluations/evaluation-execution.service";
import type { MonitorService } from "~/server/app-layer/monitors/monitor.service";
import {
  buildPreconditionTraceDataFromCommand,
  checkEvaluatorRequiredFields,
  evaluatePreconditions,
  preconditionsNeedEvents,
} from "~/server/evaluations/preconditions";
import type { CheckPreconditions } from "~/server/evaluations/types";
import type { PreconditionTraceData } from "~/server/filters/precondition-matchers";
import type { MappingState } from "~/server/tracer/tracesMapping";
import type { ElasticSearchEvent, Span } from "~/server/tracer/types";
import { extractErrorMessage } from "~/utils/captureError";
import { type EvaluationEvent, evaluationAggregate } from "../aggregate";

/**
 * The `executeEvaluation` orchestration — the pure half is
 * `evaluationAggregate.commands.report`; everything above it (fetch a
 * monitor, sample, check preconditions, run the evaluator, record cost,
 * offload oversized inputs) is I/O this function performs before ever
 * deciding an event. This is deliberately NOT one of `evaluationAggregate`'s
 * declared `commands` (`CommandDef.handle` is synchronous and pure — see
 * `aggregate.ts`'s docblock on `report`); it is application-layer
 * orchestration that calls the aggregate's pure command once it has already
 * decided the outcome. The OLD pipeline's own comment drew the identical
 * line: "executeEvaluation is NOT [a pure defineCommand] — it's a complex
 * command with DI... and stays as a manual class." This is that same
 * separation, kept, not blurred — a command that ran the evaluator, wrote
 * billing, wrote S3 and decided sampling in one place was flagged in review
 * as the shape to avoid; this function is where that necessarily I/O-heavy
 * work belongs, and `evaluationAggregate.commands` stays exactly two
 * one-line pass-throughs.
 *
 * === Defect #1 — a genuine failure must surface, never be recorded as done ===
 *
 * The dispatch loop that calls this once per monitor
 * (`evaluationTrigger`, `trace-processing/process-manager/`) is out of this
 * pipeline's directory and already durable (ADR-075's leased-outbox
 * conversion — see `specs/monitors/evaluation-dispatch-durability.feature`).
 * What belongs to THIS pipeline is not letting its own command handler
 * quietly defeat that durability from the inside: the OLD
 * `ExecuteEvaluationCommand.handle` caught EVERY exception — including ones
 * that are not `isCustomerFixable` — and converted all of them into a
 * `reported` event with `status: "error"`, returning normally rather than
 * throwing. That manufactures false finality: a transient infrastructure
 * failure (a network blip calling `evaluationExecution.executeForTrace`, a
 * downstream outage) gets permanently recorded as a completed, errored
 * evaluation that nothing will ever retry, forfeiting the very at-least-once
 * redelivery the caller's queue exists to provide — the evaluation looks
 * "done" (with a result) rather than "not yet attempted successfully".
 *
 * This rewrite keeps the SAME three-way classification the old code already
 * drew (`isCustomerFixable` below is unchanged) but acts on it differently:
 *
 * 1. **The evaluator's own normal result is `status: "error"`.** Not an
 *    exception — `evaluationExecution.executeForTrace` returned successfully
 *    with an error verdict (e.g. a malformed trace the evaluator could
 *    reason about and reject). This is a legitimate, non-exceptional
 *    business outcome and is reported as such, unchanged from before.
 * 2. **A customer-fixable failure** (`isCustomerFixable`) is a business
 *    decision, not a fault of ours — reported as `skipped`, and the caller
 *    is never asked to retry something a retry cannot fix.
 * 3. **Anything else thrown** is a genuine, unclassified failure. It is
 *    re-thrown, not swallowed — the caller's retry mechanism gets to try
 *    again, and if it exhausts its budget the failure surfaces as a failure,
 *    per `specs/monitors/evaluation-dispatch-durability.feature`'s "An
 *    evaluation that could not be requested is visible" scenario (the same
 *    principle applied one layer further in).
 */

const logger = createLogger(
  "langwatch:event-sourcing:evaluation-processing:execute-evaluation",
);

export const executeEvaluationInputSchema = z.object({
  tenantId: z.string(),
  traceId: z.string(),
  evaluationId: z.string(),
  evaluatorId: z.string(),
  evaluatorType: z.string(),
  evaluatorName: z.string().optional(),
  isGuardrail: z.boolean().optional(),
  occurredAt: z.number(),
  // Thread debouncing: when > 0, traces in the same thread share one dedup
  // key upstream of this function (the dispatch layer's concern, not this
  // one's) — carried through only because precondition matching reads it.
  threadIdleTimeout: z.number().optional(),
  threadId: z.string().optional(),
  userId: z.string().optional(),
  customerId: z.string().optional(),
  labels: z.array(z.string()).optional(),
  origin: z.string().optional(),
  hasError: z.boolean().optional(),
  promptIds: z.array(z.string()).optional(),
  topicId: z.string().optional(),
  subTopicId: z.string().optional(),
  customMetadata: z.record(z.string()).optional(),
  spanTypes: z.array(z.string()).optional(),
  spanModels: z.array(z.string()).optional(),
  computedInput: z.string().nullable().optional(),
  computedOutput: z.string().nullable().optional(),
});
export type ExecuteEvaluationInput = z.infer<
  typeof executeEvaluationInputSchema
>;

/**
 * A failure the customer can resolve themselves (provider disabled, missing
 * credentials, an oversized evaluator payload) rather than one we have to
 * fix. Unchanged from the old pipeline — see its own comment there for why
 * this reads `HandledError.fault === "customer"` rather than
 * `HandledError.isHandled(error)` (which would also downgrade a genuine
 * platform-fault `EvaluatorExecutionError`, hiding an outage behind a benign
 * skip).
 */
function isCustomerFixable(error: unknown): error is HandledError {
  return HandledError.isHandled(error) && error.fault === "customer";
}

export interface ExecuteEvaluationDeps {
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
  /** @default getAzureSafetyEnvFromProject */
  azureSafetyEnvResolver?: (
    projectId: string,
  ) => Promise<Record<string, string> | null>;
  /**
   * Offloads oversized evaluator inputs to durable object storage before the
   * event is built (ADR-098 decision 8) — the durable-reference pattern, not
   * inlining. Returns the inputs unchanged (inline) or a stored-object
   * marker; the aggregate never distinguishes the two (see `aggregate.ts`'s
   * `EvaluationState.inputs` doc). Absent means today's un-offloaded
   * behaviour, matching the old pipeline's fail-open default.
   */
  offloadInputs?: (args: {
    projectId: string;
    evaluationId: string;
    inputs: Record<string, unknown> | null;
  }) => Promise<Record<string, unknown> | null>;
}

async function buildReportedEvent(
  input: ExecuteEvaluationInput,
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
  },
  offloadInputs?: ExecuteEvaluationDeps["offloadInputs"],
): Promise<readonly EvaluationEvent[]> {
  const inputs =
    offloadInputs && result.inputs
      ? await offloadInputs({
          projectId: input.tenantId,
          evaluationId: input.evaluationId,
          inputs: result.inputs,
        })
      : (result.inputs ?? null);

  return evaluationAggregate.commands.report.handle(
    evaluationAggregate.init(),
    {
      evaluationId: input.evaluationId,
      evaluatorId: input.evaluatorId,
      evaluatorType: input.evaluatorType,
      evaluatorName: input.evaluatorName,
      traceId: input.traceId,
      isGuardrail: input.isGuardrail,
      occurredAt: input.occurredAt,
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
    evaluationAggregate.events,
  );
}

export async function executeEvaluation(
  deps: ExecuteEvaluationDeps,
  input: ExecuteEvaluationInput,
): Promise<readonly EvaluationEvent[]> {
  const { tenantId } = input;

  logger.debug(
    {
      tenantId,
      evaluationId: input.evaluationId,
      evaluatorId: input.evaluatorId,
      traceId: input.traceId,
    },
    "Handling execute evaluation",
  );

  const monitor = await deps.monitors.getMonitorById({
    projectId: tenantId,
    monitorId: input.evaluatorId,
  });
  if (!monitor) {
    logger.warn(
      { tenantId, evaluatorId: input.evaluatorId },
      "Monitor not found — skipping evaluation",
    );
    return buildReportedEvent(input, {
      status: "skipped",
      details: "Monitor not found",
    });
  }

  if (isAzureEvaluatorType(monitor.checkType)) {
    const azureEnvResolver =
      deps.azureSafetyEnvResolver ?? getAzureSafetyEnvFromProject;
    const azureEnv = await azureEnvResolver(tenantId);
    if (!azureEnv) {
      logger.warn(
        {
          tenantId,
          evaluatorId: input.evaluatorId,
          evaluatorType: monitor.checkType,
        },
        "Azure Safety provider not configured — skipping evaluation",
      );
      return buildReportedEvent(input, {
        status: "skipped",
        details: AZURE_SAFETY_NOT_CONFIGURED_MESSAGE,
      });
    }
  }

  if (Math.random() > monitor.sample) {
    logger.debug(
      { tenantId, evaluatorId: input.evaluatorId, sample: monitor.sample },
      "Evaluation excluded by sampling",
    );
    return [];
  }

  const spans = await deps.spanStorage.getSpansByTraceId({
    tenantId,
    traceId: input.traceId,
    occurredAtMs: input.occurredAt,
  });

  const requiredFieldsMet = checkEvaluatorRequiredFields({
    evaluatorType: monitor.checkType,
    spans,
  });
  if (!requiredFieldsMet) {
    logger.debug(
      { tenantId, evaluatorId: input.evaluatorId, traceId: input.traceId },
      "Evaluator required fields not met — skipping evaluation",
    );
    return [];
  }

  const preconditions = (monitor.preconditions ?? []) as CheckPreconditions;

  let events: PreconditionTraceData["events"] = null;
  if (preconditionsNeedEvents(preconditions)) {
    const traceEvents = await deps.traceEvents.getEventsByTraceId({
      tenantId,
      traceId: input.traceId,
    });
    events = traceEvents.map((e) => ({
      event_type: e.event_type,
      metrics: e.metrics ?? [],
      event_details: e.event_details ?? [],
    }));
  }

  const traceData = buildPreconditionTraceDataFromCommand({
    data: input,
    spans,
    events,
  });
  const preconditionsMet = evaluatePreconditions({ traceData, preconditions });
  if (!preconditionsMet) {
    logger.debug(
      { tenantId, evaluatorId: input.evaluatorId, traceId: input.traceId },
      "Preconditions not met — skipping evaluation",
    );
    return [];
  }

  const settings = monitor.evaluator?.config
    ? ((monitor.evaluator.config as Record<string, unknown>).settings ??
      monitor.parameters)
    : monitor.parameters;
  const workflowId =
    monitor.evaluator?.type === "workflow"
      ? monitor.evaluator.workflowId
      : undefined;

  try {
    const result = await deps.evaluationExecution.executeForTrace({
      projectId: tenantId,
      traceId: input.traceId,
      evaluatorType: input.evaluatorType,
      settings: settings as Record<string, unknown>,
      mappings: monitor.mappings as MappingState | null,
      level: monitor.level as "trace" | "thread",
      workflowId,
    });

    // A trace the service could not evaluate — its own normal return value,
    // not an exception. Dropped with no event, like an unmet precondition.
    if (result.status === "skipped") {
      logger.debug(
        {
          tenantId,
          evaluatorId: input.evaluatorId,
          traceId: input.traceId,
          details: result.details,
        },
        "Trace not evaluatable — skipping with no result event",
      );
      return [];
    }

    let costId: string | null = null;
    if (result.status === "processed" && result.cost) {
      costId = await deps.costRecorder.recordCost({
        projectId: tenantId,
        // The natural key that makes the write idempotent under at-least-once
        // delivery: `evaluationId` is fixed in the input, so a retry lands on
        // the same Cost row instead of billing twice. A genuine re-evaluation
        // gets a fresh evaluationId from the caller.
        evaluationId: input.evaluationId,
        isGuardrail: !!input.isGuardrail,
        evaluatorName: input.evaluatorName ?? input.evaluatorType,
        evaluatorId: input.evaluatorId,
        traceId: input.traceId,
        amount: result.cost.amount,
        currency: result.cost.currency,
      });
    }

    const isError = result.status === "error";
    const errorField = isError
      ? (result.error ?? result.details ?? "Evaluator failed")
      : result.error;

    return buildReportedEvent(
      input,
      {
        status: result.status,
        score: result.score,
        passed: result.passed,
        label: result.label,
        details: isError ? undefined : result.details,
        error: errorField,
        errorDetails: result.errorDetails ?? null,
        inputs: result.inputs ?? null,
        costId,
      },
      deps.offloadInputs,
    );
  } catch (error) {
    if (isCustomerFixable(error)) {
      logger.info(
        {
          ...error.meta,
          code: error.code,
          tenantId,
          evaluationId: input.evaluationId,
          evaluatorId: input.evaluatorId,
          traceId: input.traceId,
          error: error.message,
        },
        "Customer-fixable evaluator failure — skipping evaluation",
      );
      return buildReportedEvent(input, {
        status: "skipped",
        details: error.message,
      });
    }

    // Not customer-fixable: a genuine, unclassified failure. Re-thrown, not
    // recorded as a permanent "error" result — see the module docblock's
    // "Defect #1" section for why swallowing it here would be exactly the
    // silent-absorption failure this rewrite must not reintroduce.
    logger.error(
      {
        tenantId,
        evaluationId: input.evaluationId,
        evaluatorId: input.evaluatorId,
        traceId: input.traceId,
        error: extractErrorMessage(error),
      },
      "Evaluation execution failed — re-throwing for the caller's retry policy",
    );
    throw error;
  }
}
