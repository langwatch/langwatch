import type { EmittedEvent } from "@langwatch/event-sourcing";
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
import type { evaluationEvents } from "../events";
import { reportEvaluation } from "../report.command";

/**
 * The orchestration around `reportEvaluation`: fetch the monitor,
 * sample, check preconditions, run the evaluator, record cost, offload
 * oversized inputs — all I/O, all before an event is decided, none of it
 * expressible in a command handler, which is synchronous and pure.
 *
 * A failure that is not customer-fixable is re-thrown, never recorded as a
 * permanent `error` result: recording it manufactures finality for something a
 * retry might fix (specs/monitors/evaluation-dispatch-durability.feature).
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
 * credentials, an oversized payload). Keyed on `fault === "customer"`, not on
 * `isHandled`: a platform-fault `HandledError` is an outage, and downgrading
 * it to a skip would hide one.
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
   * event is built, returning either the inputs unchanged or a stored-object
   * marker. Absent means no offload — the fail-open default.
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
): Promise<readonly EmittedEvent<typeof evaluationEvents>[]> {
  const inputs =
    offloadInputs && result.inputs
      ? await offloadInputs({
          projectId: input.tenantId,
          evaluationId: input.evaluationId,
          inputs: result.inputs,
        })
      : (result.inputs ?? null);

  return reportEvaluation({
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
  });
}

export async function executeEvaluation(
  deps: ExecuteEvaluationDeps,
  input: ExecuteEvaluationInput,
): Promise<readonly EmittedEvent<typeof evaluationEvents>[]> {
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

    // Not customer-fixable: re-thrown rather than recorded as a permanent
    // "error" result, which would manufacture finality a retry could fix.
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
