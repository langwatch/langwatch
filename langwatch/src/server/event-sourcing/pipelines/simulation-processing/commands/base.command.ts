import { createLogger } from "../../../../../utils/logger/server";
import type { Command, CommandHandler } from "../../../library";
import { createTenantId, EventUtils } from "../../../library";
import type { SimulationProcessingEvent } from "../schemas/events";

/**
 * Configuration for a simulation command handler.
 */
export interface SimulationCommandConfig<TCommandData, TEventData> {
  eventType: string;
  eventVersion: string;
  loggerName: string;
  handleLogMessage: string;
  emitLogMessage: string;
  mapToEventData: (commandData: TCommandData) => TEventData;
  getLogContext: (commandData: TCommandData) => Record<string, unknown>;
}

/**
 * Creates a command handler function for simulation commands.
 */
export function createSimulationCommandHandler<
  TCommandData extends { tenantId: string; scenarioRunId: string; occurredAt: number },
  TEvent extends SimulationProcessingEvent,
  TEventData,
>(
  config: SimulationCommandConfig<TCommandData, TEventData>,
): CommandHandler<Command<TCommandData>, SimulationProcessingEvent>["handle"] {
  const logger = createLogger(
    `langwatch:simulation-processing:${config.loggerName}`,
  );

  return async (
    command: Command<TCommandData>,
  ): Promise<SimulationProcessingEvent[]> => {
    const { tenantId: tenantIdStr, data: commandData } = command;
    const tenantId = createTenantId(tenantIdStr);
    const { scenarioRunId } = commandData;

    logger.info(
      {
        tenantId,
        scenarioRunId,
        ...config.getLogContext(commandData),
      },
      config.handleLogMessage,
    );

    const event = EventUtils.createEvent<TEvent>({
      aggregateType: "simulation_run",
      aggregateId: scenarioRunId,
      tenantId,
      type: config.eventType as TEvent["type"],
      version: config.eventVersion as TEvent["version"],
      data: config.mapToEventData(commandData) as TEvent["data"],
      occurredAt: commandData.occurredAt,
    });

    logger.debug(
      {
        tenantId,
        scenarioRunId,
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
 * Format: {tenantId}:{scenarioRunId}:{suffix}
 */
export function makeJobIdWithSuffix<
  T extends { tenantId: string; scenarioRunId: string },
>(payload: T, suffix: string): string {
  return `${payload.tenantId}:${payload.scenarioRunId}:${suffix}`;
}
