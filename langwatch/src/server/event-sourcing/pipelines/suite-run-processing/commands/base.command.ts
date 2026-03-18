import type { Command, CommandHandler } from "../../../";
import { createTenantId, EventUtils } from "../../../";
import { createLogger } from "../../../../../utils/logger";
import type { SuiteRunProcessingEvent } from "../schemas/events";

/**
 * Configuration for a suite run command handler.
 * Defines the event type, version, and how to map command data to event data.
 */
export interface SuiteRunCommandConfig<TCommandData, TEventData> {
  /** The event type constant (e.g., "lw.suite_run.started") */
  eventType: string;
  /** The event version constant (e.g., "2026-03-01") */
  eventVersion: string;
  /** Logger namespace suffix (e.g., "start-suite-run") */
  loggerName: string;
  /** Log message for when command is handled */
  handleLogMessage: string;
  /** Log message for when event is emitted */
  emitLogMessage: string;
  /** Maps command data to event data */
  mapToEventData: (commandData: TCommandData) => TEventData;
  /** Extracts additional log context from command data */
  getLogContext: (commandData: TCommandData) => Record<string, unknown>;
  /** Builds idempotency key for event-store deduplication */
  makeIdempotencyKey: (commandData: TCommandData) => string;
}

/**
 * Creates a command handler function for suite run commands.
 * Uses composition to share common logic across different command types.
 */
export function createSuiteRunCommandHandler<
  TCommandData extends { tenantId: string; batchRunId: string; occurredAt: number },
  TEvent extends SuiteRunProcessingEvent,
  TEventData,
>(
  config: SuiteRunCommandConfig<TCommandData, TEventData>,
): CommandHandler<
  Command<TCommandData>,
  SuiteRunProcessingEvent
>["handle"] {
  const logger = createLogger(
    `langwatch:suite-run-processing:${config.loggerName}`,
  );

  return async (
    command: Command<TCommandData>,
  ): Promise<SuiteRunProcessingEvent[]> => {
    const { tenantId: tenantIdStr, data: commandData } = command;
    const tenantId = createTenantId(tenantIdStr);
    const { batchRunId } = commandData;

    logger.debug(
      {
        tenantId,
        batchRunId,
        ...config.getLogContext(commandData),
      },
      config.handleLogMessage,
    );

    const event = EventUtils.createEvent<TEvent>({
      aggregateType: "suite_run",
      aggregateId: batchRunId,
      tenantId,
      type: config.eventType as TEvent["type"],
      version: config.eventVersion as TEvent["version"],
      data: config.mapToEventData(commandData) as TEvent["data"],
      occurredAt: commandData.occurredAt,
      idempotencyKey: config.makeIdempotencyKey(commandData),
    });

    logger.debug(
      {
        tenantId,
        batchRunId,
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
 * Format: {tenantId}:{batchRunId}:{suffix}
 */
export function makeJobIdWithSuffix<
  T extends { tenantId: string; batchRunId: string },
>(payload: T, suffix: string): string {
  return `${payload.tenantId}:${payload.batchRunId}:${suffix}`;
}
