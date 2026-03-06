import type { Command, CommandHandler } from "../../../";
import { createTenantId, EventUtils } from "../../../";
import { createLogger } from "../../../../../utils/logger";
import type { SuiteRunProcessingEvent } from "../schemas/events";
import { makeSuiteRunKey } from "../utils/compositeKey";

/**
 * Configuration for a suite run command handler.
 */
export interface SuiteRunCommandConfig<TCommandData, TEventData> {
  eventType: string;
  eventVersion: string;
  loggerName: string;
  handleLogMessage: string;
  emitLogMessage: string;
  mapToEventData: (commandData: TCommandData) => TEventData;
  getLogContext: (commandData: TCommandData) => Record<string, unknown>;
}

/**
 * Creates a command handler function for suite run commands.
 */
export function createSuiteRunCommandHandler<
  TCommandData extends { tenantId: string; suiteId: string; batchRunId: string; occurredAt: number },
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
    const aggregateId = makeSuiteRunKey(commandData.suiteId, commandData.batchRunId);

    logger.info(
      {
        tenantId,
        suiteId: commandData.suiteId,
        batchRunId: commandData.batchRunId,
        ...config.getLogContext(commandData),
      },
      config.handleLogMessage,
    );

    const event = EventUtils.createEvent<TEvent>({
      aggregateType: "suite_run",
      aggregateId,
      tenantId,
      type: config.eventType as TEvent["type"],
      version: config.eventVersion as TEvent["version"],
      data: config.mapToEventData(commandData) as TEvent["data"],
      occurredAt: commandData.occurredAt,
    });

    logger.debug(
      {
        tenantId,
        suiteId: commandData.suiteId,
        batchRunId: commandData.batchRunId,
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
export function makeSuiteRunJobId<
  T extends { tenantId: string; batchRunId: string },
>(payload: T, suffix: string): string {
  return `${payload.tenantId}:${payload.batchRunId}:${suffix}`;
}
