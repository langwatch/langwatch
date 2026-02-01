import { createLogger } from "../../../../../utils/logger";
import type { Command, CommandHandler } from "../../../library";
import { createTenantId, EventUtils } from "../../../library";
import type { BatchEvaluationProcessingEvent } from "../schemas/events";

/**
 * Configuration for a batch evaluation command handler.
 * Defines the event type, version, and how to map command data to event data.
 */
export interface BatchEvaluationCommandConfig<TCommandData, TEventData> {
  /** The event type constant (e.g., "lw.batch-evaluation.started") */
  eventType: string;
  /** The event version constant (e.g., "2025-02-01") */
  eventVersion: string;
  /** Logger namespace suffix (e.g., "start-batch-evaluation") */
  loggerName: string;
  /** Log message for when command is handled */
  handleLogMessage: string;
  /** Log message for when event is emitted */
  emitLogMessage: string;
  /** Maps command data to event data */
  mapToEventData: (commandData: TCommandData) => TEventData;
  /** Extracts additional log context from command data */
  getLogContext: (commandData: TCommandData) => Record<string, unknown>;
}

/**
 * Creates a command handler function for batch evaluation commands.
 * Uses composition to share common logic across different command types.
 *
 * @param config - Configuration for this command handler
 * @returns A command handler that processes commands and emits events
 */
export function createBatchEvaluationCommandHandler<
  TCommandData extends { tenantId: string; runId: string },
  TEvent extends BatchEvaluationProcessingEvent,
  TEventData,
>(
  config: BatchEvaluationCommandConfig<TCommandData, TEventData>,
): CommandHandler<
  Command<TCommandData>,
  BatchEvaluationProcessingEvent
>["handle"] {
  const logger = createLogger(
    `langwatch:batch-evaluation-processing:${config.loggerName}`,
  );

  return async (
    command: Command<TCommandData>,
  ): Promise<BatchEvaluationProcessingEvent[]> => {
    const { tenantId: tenantIdStr, data: commandData } = command;
    const tenantId = createTenantId(tenantIdStr);
    const { runId } = commandData;

    logger.info(
      {
        tenantId,
        runId,
        ...config.getLogContext(commandData),
      },
      config.handleLogMessage,
    );

    const event = EventUtils.createEvent<TEvent>(
      "batch_evaluation_run",
      runId,
      tenantId,
      config.eventType as TEvent["type"],
      config.eventVersion as TEvent["version"],
      config.mapToEventData(commandData) as TEvent["data"],
    );

    logger.debug(
      {
        tenantId,
        runId,
        eventId: event.id,
        eventType: event.type,
      },
      config.emitLogMessage,
    );

    return [event];
  };
}

/**
 * Create a unique job ID for deduplication.
 * Format: {tenantId}:{runId}:{suffix}
 */
export function makeJobIdWithSuffix<
  T extends { tenantId: string; runId: string },
>(payload: T, suffix: string): string {
  return `${payload.tenantId}:${payload.runId}:${suffix}`;
}

/**
 * Create a unique job ID for result-based commands.
 * Format: {tenantId}:{runId}:{index}:{targetId}:{suffix}
 */
export function makeResultJobId<
  T extends {
    tenantId: string;
    runId: string;
    index: number;
    targetId: string;
  },
>(payload: T, suffix: string): string {
  return `${payload.tenantId}:${payload.runId}:${payload.index}:${payload.targetId}:${suffix}`;
}

/**
 * Create a unique job ID for evaluator result commands.
 * Format: {tenantId}:{runId}:{index}:{targetId}:{evaluatorId}:{suffix}
 */
export function makeEvaluatorResultJobId<
  T extends {
    tenantId: string;
    runId: string;
    index: number;
    targetId: string;
    evaluatorId: string;
  },
>(payload: T, suffix: string): string {
  return `${payload.tenantId}:${payload.runId}:${payload.index}:${payload.targetId}:${payload.evaluatorId}:${suffix}`;
}
