import type { Command, CommandHandler } from "../../../";
import { createTenantId, EventUtils } from "../../../";
import { createLogger } from "../../../../../utils/logger/server";
import type { EvaluationProcessingEvent } from "../schemas/events";

/**
 * Configuration for an evaluation command handler.
 * Defines the event type, version, and how to map command data to event data.
 */
export interface EvaluationCommandConfig<TCommandData, TEventData> {
  /** The event type constant (e.g., "lw.evaluation.scheduled") */
  eventType: string;
  /** The event version constant (e.g., "2025-01-14") */
  eventVersion: string;
  /** Logger namespace suffix (e.g., "schedule-evaluation") */
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
 * Creates a command handler function for evaluation commands.
 * Uses composition to share common logic across different command types.
 *
 * @param config - Configuration for this command handler
 * @returns A command handler that processes commands and emits events
 */
export function createEvaluationCommandHandler<
  TCommandData extends { tenantId: string; evaluationId: string; occurredAt: number },
  TEvent extends EvaluationProcessingEvent,
  TEventData,
>(
  config: EvaluationCommandConfig<TCommandData, TEventData>,
): CommandHandler<Command<TCommandData>, EvaluationProcessingEvent>["handle"] {
  const logger = createLogger(
    `langwatch:evaluation-processing:${config.loggerName}`,
  );

  return async (
    command: Command<TCommandData>,
  ): Promise<EvaluationProcessingEvent[]> => {
    const { tenantId: tenantIdStr, data: commandData } = command;
    const tenantId = createTenantId(tenantIdStr);
    const { evaluationId } = commandData;

    logger.info(
      {
        tenantId,
        evaluationId,
        ...config.getLogContext(commandData),
      },
      config.handleLogMessage,
    );

    const event = EventUtils.createEvent<TEvent>({
      aggregateType: "evaluation",
      aggregateId: evaluationId,
      tenantId,
      type: config.eventType as TEvent["type"],
      version: config.eventVersion as TEvent["version"],
      data: config.mapToEventData(commandData) as TEvent["data"],
      occurredAt: commandData.occurredAt,
    });

    logger.debug(
      {
        tenantId,
        evaluationId,
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
 * Format: {tenantId}:{evaluationId}:{suffix}
 */
export function makeJobIdWithSuffix<
  T extends { tenantId: string; evaluationId: string },
>(payload: T, suffix: string): string {
  return `${payload.tenantId}:${payload.evaluationId}:${suffix}`;
}
