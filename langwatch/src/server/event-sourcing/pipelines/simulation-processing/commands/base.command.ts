import type { Command, CommandHandler } from "../../../";
import { createTenantId, EventUtils } from "../../../";
import { createLogger } from "../../../../../utils/logger";
import type { SimulationProcessingEvent } from "../schemas/events";

/**
 * Configuration for a simulation command handler.
 * Defines the event type, version, and how to map command data to event data.
 */
export interface SimulationCommandConfig<TCommandData, TEventData> {
  /** The event type constant (e.g., "lw.simulation_run.started") */
  eventType: string;
  /** The event version constant (e.g., "2026-02-01") */
  eventVersion: string;
  /** Logger namespace suffix (e.g., "start-run") */
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
 * Creates a command handler function for simulation commands.
 * Uses composition to share common logic across different command types.
 *
 * @param config - Configuration for this command handler
 * @returns A command handler that processes commands and emits events
 */
export function createSimulationCommandHandler<
  TCommandData extends { tenantId: string; scenarioRunId: string; occurredAt: number },
  TEvent extends SimulationProcessingEvent,
  TEventData,
>(
  config: SimulationCommandConfig<TCommandData, TEventData>,
): CommandHandler<
  Command<TCommandData>,
  SimulationProcessingEvent
>["handle"] {
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
