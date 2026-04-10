import { generate } from "@langwatch/ksuid";
import type { Command, CommandHandler } from "../../../";
import {
  createTenantId,
  defineCommandSchema,
  EventUtils,
} from "../../../";
import { extractErrorMessage } from "../../../../../utils/captureError";
import { KSUID_RESOURCES } from "../../../../../utils/constants";
import { createLogger } from "../../../../../utils/logger/server";
import {
  AZURE_SAFETY_NOT_CONFIGURED_MESSAGE,
  getAzureSafetyEnvFromProject,
  isAzureEvaluatorType,
} from "../../../../app-layer/evaluations/azure-safety-env";
import type { EvaluationCostRecorder } from "../../../../app-layer/evaluations/evaluation-cost.recorder";
import type { EvaluationExecutionService } from "../../../../app-layer/evaluations/evaluation-execution.service";
import type { MonitorService } from "../../../../app-layer/monitors/monitor.service";
import {
  evaluatePreconditions,
  buildPreconditionTraceDataFromCommand,
  checkEvaluatorRequiredFields,
  preconditionsNeedEvents,
} from "../../../../evaluations/preconditions";
import type { PreconditionTraceData } from "../../../../filters/precondition-matchers";
import type { CheckPreconditions } from "../../../../evaluations/types";
import type { MappingState } from "../../../../tracer/tracesMapping";
import type { ElasticSearchEvent, Span } from "../../../../tracer/types";
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

export interface ExecuteEvaluationCommandDeps {
  monitors: MonitorService;
  spanStorage: { getSpansByTraceId(params: { tenantId: string; traceId: string }): Promise<Span[]> };
  traceEvents: { getEventsByTraceId(params: { tenantId: string; traceId: string }): Promise<ElasticSearchEvent[]> };
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
}

const SCHEMA = defineCommandSchema(
  EXECUTE_EVALUATION_COMMAND_TYPE,
  executeEvaluationCommandDataSchema,
  "Command to execute a single evaluation",
);

/**
 * Command handler for executing evaluations.
 *
 * Sampling + preconditions + execution -> emits a single EvaluationReportedEvent.
 * Results are persisted to CH via the evaluationRun fold projection.
 * Deduped by traceId + evaluatorId (makeJobId), delayed 30s.
 *
 * Uses constructor DI — instantiate with deps and pass via `.withCommandInstance()`.
 */
export class ExecuteEvaluationCommand implements CommandHandler<
  Command<ExecuteEvaluationCommandData>,
  EvaluationProcessingEvent
> {
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

    // 1. Fetch monitor via service
    const monitor = await this.deps.monitors.getMonitorById({
      projectId: tenantId,
      monitorId: data.evaluatorId,
    });
    if (!monitor) {
      logger.warn(
        { tenantId: tenantId, evaluatorId: data.evaluatorId },
        "Monitor not found — skipping evaluation",
      );
      return emitReported(data, tenantId, {
        status: "skipped",
        details: "Monitor not found",
      });
    }

    // 1a. Azure Safety BYOK gate — hard cutover to per-project credentials.
    // If the monitor uses an Azure evaluator and the project has no
    // azure_safety provider configured, skip with a clear configure message
    // so the customer can self-serve the fix from the UI.
    if (isAzureEvaluatorType(monitor.checkType)) {
      const azureEnvResolver =
        this.deps.azureSafetyEnvResolver ?? getAzureSafetyEnvFromProject;
      const azureEnv = await azureEnvResolver(tenantId);
      if (!azureEnv) {
        logger.warn(
          {
            tenantId,
            evaluatorId: data.evaluatorId,
            evaluatorType: monitor.checkType,
          },
          "Azure Safety provider not configured — skipping evaluation",
        );
        return emitReported(data, tenantId, {
          status: "skipped",
          details: AZURE_SAFETY_NOT_CONFIGURED_MESSAGE,
        });
      }
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

    // 3. Read spans from CH, check evaluator required fields + preconditions
    const spans = await this.deps.spanStorage.getSpansByTraceId({ tenantId, traceId: data.traceId });

    // Check evaluator required fields first
    const requiredFieldsMet = checkEvaluatorRequiredFields({
      evaluatorType: monitor.checkType,
      spans,
    });
    if (!requiredFieldsMet) {
      logger.debug(
        {
          tenantId: tenantId,
          evaluatorId: data.evaluatorId,
          traceId: data.traceId,
        },
        "Evaluator required fields not met — skipping evaluation",
      );
      return [];
    }

    // Then check user-configured preconditions
    const preconditions = (monitor.preconditions ?? []) as CheckPreconditions;

    // Fetch events on demand if any preconditions reference event fields
    let events: PreconditionTraceData["events"] = null;
    if (preconditionsNeedEvents(preconditions)) {
      const traceEvents = await this.deps.traceEvents.getEventsByTraceId({
        tenantId,
        traceId: data.traceId,
      });
      events = traceEvents.map((e) => ({
        event_type: e.event_type,
        metrics: e.metrics ?? [],
        event_details: e.event_details ?? [],
      }));
    }

    const traceData = buildPreconditionTraceDataFromCommand({ data, spans, events });
    const preconditionsMet = evaluatePreconditions({
      traceData,
      preconditions,
    });

    if (!preconditionsMet) {
      logger.debug(
        {
          tenantId: tenantId,
          evaluatorId: data.evaluatorId,
          traceId: data.traceId,
        },
        "Preconditions not met — skipping evaluation",
      );
      return []; // No events — preconditions didn't match
    }

    // 4. Run evaluation via app-layer service
    const settings = monitor.evaluator?.config
      ? ((monitor.evaluator.config as Record<string, any>).settings ??
        monitor.parameters)
      : monitor.parameters;

    const workflowId =
      monitor.evaluator?.type === "workflow"
        ? monitor.evaluator.workflowId
        : undefined;

    try {
      const result = await this.deps.evaluationExecution.executeForTrace({
        projectId: tenantId,
        traceId: data.traceId,
        evaluatorType: data.evaluatorType,
        settings: settings as Record<string, any>,
        mappings: monitor.mappings as MappingState | null,
        level: monitor.level as "trace" | "thread",
        workflowId,
      });

      // 5. Record cost via service
      let costId: string | null = null;
      if (result.status === "processed" && result.cost) {
        costId = await this.deps.costRecorder.recordCost({
          projectId: tenantId,
          isGuardrail: !!data.isGuardrail,
          evaluatorName: data.evaluatorName ?? data.evaluatorType,
          evaluatorId: data.evaluatorId,
          traceId: data.traceId,
          amount: result.cost.amount,
          currency: result.cost.currency,
        });
      }

      // 6. Emit single reported event — fold projection persists to CH
      return emitReported(data, tenantId, {
        status: result.status,
        score: result.score,
        passed: result.passed,
        label: result.label,
        details: result.details,
        inputs: result.inputs ?? null,
        costId,
      });
    } catch (error) {
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

      return emitReported(data, tenantId, {
        status: "error",
        error: extractErrorMessage(error),
        errorDetails: error instanceof Error ? error.stack ?? null : null,
      });
    }
  }
}

function emitReported(
  data: ExecuteEvaluationCommandData,
  tenantId: ReturnType<typeof createTenantId>,
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
): EvaluationProcessingEvent[] {
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
      inputs: result.inputs ?? null,
      error: result.error ?? null,
      errorDetails: result.errorDetails ?? null,
      costId: result.costId ?? null,
    },
    occurredAt: data.occurredAt,
    idempotencyKey: `${data.tenantId}:${data.evaluationId}:reported`,
  });

  return [event];
}
