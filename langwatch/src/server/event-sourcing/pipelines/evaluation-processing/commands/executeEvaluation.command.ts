import { generate } from "@langwatch/ksuid";
import type { PrismaClient } from "@prisma/client";
import { CostReferenceType, CostType } from "@prisma/client";
import type { Command, CommandHandler } from "../../../";
import {
  createTenantId,
  defineCommandSchema,
  EventUtils,
} from "../../../";
import { extractErrorMessage } from "../../../../../utils/captureError";
import { KSUID_RESOURCES } from "../../../../../utils/constants";
import { createLogger } from "../../../../../utils/logger/server";
import type { EvaluationExecutionService } from "../../../../app-layer/evaluations/evaluation-execution.service";
import {
  evaluatePreconditions,
  type PreconditionTrace,
} from "../../../../evaluations/preconditions";
import type { CheckPreconditions } from "../../../../evaluations/types";
import type { MappingState } from "../../../../tracer/tracesMapping";
import type { Span } from "../../../../tracer/types";
import type { ExecuteEvaluationCommandData } from "../schemas/commands";
import { executeEvaluationCommandDataSchema } from "../schemas/commands";
import {
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_COMPLETED_EVENT_VERSION_LATEST,
  EVALUATION_SCHEDULED_EVENT_TYPE,
  EVALUATION_SCHEDULED_EVENT_VERSION_LATEST,
  EXECUTE_EVALUATION_COMMAND_TYPE,
} from "../schemas/constants";
import type {
  EvaluationCompletedEvent,
  EvaluationProcessingEvent,
  EvaluationScheduledEvent,
} from "../schemas/events";

const logger = createLogger(
  "langwatch:evaluation-processing:execute-evaluation",
);

export interface ExecuteEvaluationCommandDeps {
  prisma: PrismaClient;
  spanStorage: { getSpansByTraceId(params: { tenantId: string; traceId: string }): Promise<Span[]> };
  evaluationExecution: EvaluationExecutionService;
}

const SCHEMA = defineCommandSchema(
  EXECUTE_EVALUATION_COMMAND_TYPE,
  executeEvaluationCommandDataSchema,
  "Command to execute a single evaluation",
);

function getAggregateId(payload: ExecuteEvaluationCommandData): string {
  return payload.evaluationId;
}

function getSpanAttributes(
  payload: ExecuteEvaluationCommandData,
): Record<string, string | number | boolean> {
  return {
    "payload.evaluation.id": payload.evaluationId,
    "payload.evaluator.id": payload.evaluatorId,
    "payload.evaluator.type": payload.evaluatorType,
    "payload.trace.id": payload.traceId,
  };
}

function makeJobId(payload: ExecuteEvaluationCommandData): string {
  if (
    payload.threadIdleTimeout &&
    payload.threadIdleTimeout > 0 &&
    payload.threadId
  ) {
    return `exec:${payload.tenantId}:thread:${payload.threadId}:${payload.evaluatorId}`;
  }
  return `exec:${payload.tenantId}:${payload.traceId}:${payload.evaluatorId}`;
}

/**
 * Factory that returns a CommandHandlerClass for executing evaluations.
 *
 * The returned class closes over deps so the framework can instantiate it
 * with `new ()` (zero-arg constructor) as required by `withCommand`.
 *
 * Preconditions + execution -> emits [ScheduledEvent, CompletedEvent].
 * Sampling is handled upstream in the evaluationTrigger reactor.
 * Results are persisted to CH via the evaluationRun fold projection.
 * Deduped by traceId + evaluatorId (makeJobId), delayed 30s.
 */
export function createExecuteEvaluationCommandClass(deps: ExecuteEvaluationCommandDeps) {
  return class ExecuteEvaluationCommand implements CommandHandler<
    Command<ExecuteEvaluationCommandData>,
    EvaluationProcessingEvent
  > {
    static readonly schema = SCHEMA;
    static readonly getAggregateId = getAggregateId;
    static readonly getSpanAttributes = getSpanAttributes;
    static readonly makeJobId = makeJobId;

    async handle(
      command: Command<ExecuteEvaluationCommandData>,
    ): Promise<EvaluationProcessingEvent[]> {
      const { tenantId, data } = command;

      logger.info(
        {
          tenantId: tenantId,
          evaluationId: data.evaluationId,
          evaluatorId: data.evaluatorId,
          traceId: data.traceId,
        },
        "Handling execute evaluation command",
      );

      // 1. Fetch monitor from Prisma
      const monitor = await deps.prisma.monitor.findUnique({
        where: { id: data.evaluatorId, projectId: tenantId },
        include: { evaluator: true },
      });
      if (!monitor) {
        logger.warn(
          { tenantId: tenantId, evaluatorId: data.evaluatorId },
          "Monitor not found — skipping evaluation",
        );
        return emitScheduledAndCompleted(data, tenantId, {
          status: "skipped",
          details: "Monitor not found",
        });
      }

      // 2. Read spans from CH, check preconditions
      const spans = await deps.spanStorage.getSpansByTraceId({ tenantId, traceId: data.traceId });

      const preconditionTrace: PreconditionTrace = {
        input: { value: "" },
        output: { value: "" },
        metadata: {
          labels: data.labels ?? [],
          thread_id: data.threadId,
          user_id: data.userId,
          customer_id: data.customerId,
        },
        expected_output: undefined,
      };

      const preconditions = (monitor.preconditions ?? []) as CheckPreconditions;
      const preconditionsMet = evaluatePreconditions(
        monitor.checkType,
        preconditionTrace,
        spans,
        preconditions,
      );

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
        const result = await deps.evaluationExecution.executeForTrace({
          projectId: tenantId,
          traceId: data.traceId,
          evaluatorType: data.evaluatorType,
          settings: settings as Record<string, any>,
          mappings: monitor.mappings as MappingState | null,
          level: monitor.level as "trace" | "thread",
          workflowId,
        });

        // 5. Create cost row
        if (result.status === "processed" && result.cost) {
          await deps.prisma.cost.create({
            data: {
              id: generate(KSUID_RESOURCES.COST).toString(),
              projectId: tenantId,
              costType: data.isGuardrail ? CostType.GUARDRAIL : CostType.TRACE_CHECK,
              costName: data.evaluatorName ?? data.evaluatorType,
              referenceType: CostReferenceType.CHECK,
              referenceId: data.evaluatorId,
              amount: result.cost.amount,
              currency: result.cost.currency,
              extraInfo: { trace_id: data.traceId },
            },
          });
        }

        // 6. Emit events — fold projection persists to CH
        return emitScheduledAndCompleted(data, tenantId, {
          status: result.status,
          score: result.score,
          passed: result.passed,
          label: result.label,
          details: result.details,
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

        return emitScheduledAndCompleted(data, tenantId, {
          status: "error",
          error: extractErrorMessage(error),
        });
      }
    }
  };
}

function emitScheduledAndCompleted(
  data: ExecuteEvaluationCommandData,
  tenantId: ReturnType<typeof createTenantId>,
  result: {
    status: "processed" | "error" | "skipped";
    score?: number;
    passed?: boolean;
    label?: string;
    details?: string;
    error?: string;
  },
): EvaluationProcessingEvent[] {
  const scheduledEvent = EventUtils.createEvent<EvaluationScheduledEvent>({
    aggregateType: "evaluation",
    aggregateId: data.evaluationId,
    tenantId,
    type: EVALUATION_SCHEDULED_EVENT_TYPE,
    version: EVALUATION_SCHEDULED_EVENT_VERSION_LATEST,
    data: {
      evaluationId: data.evaluationId,
      evaluatorId: data.evaluatorId,
      evaluatorType: data.evaluatorType,
      evaluatorName: data.evaluatorName,
      traceId: data.traceId,
      isGuardrail: data.isGuardrail,
    },
    occurredAt: data.occurredAt,
  });

  const completedEvent = EventUtils.createEvent<EvaluationCompletedEvent>({
    aggregateType: "evaluation",
    aggregateId: data.evaluationId,
    tenantId,
    type: EVALUATION_COMPLETED_EVENT_TYPE,
    version: EVALUATION_COMPLETED_EVENT_VERSION_LATEST,
    data: {
      evaluationId: data.evaluationId,
      status: result.status,
      score: result.score ?? null,
      passed: result.passed ?? null,
      label: result.label ?? null,
      details: result.details ?? null,
      error: result.error ?? null,
    },
    occurredAt: Date.now(),
  });

  return [scheduledEvent, completedEvent];
}
