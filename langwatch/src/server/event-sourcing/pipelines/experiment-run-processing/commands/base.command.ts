import type { Command, CommandHandler } from "../../../";
import { createTenantId, EventUtils } from "../../../";
import { createLogger } from "../../../../../utils/logger";
import type { ExperimentRunProcessingEvent } from "../schemas/events";

/**
 * Configuration for an experiment run command handler.
 * Defines the event type, version, and how to map command data to event data.
 */
export interface ExperimentRunCommandConfig<TCommandData, TEventData> {
  /** The event type constant (e.g., "lw.experiment_run.started") */
  eventType: string;
  /** The event version constant (e.g., "2025-02-01") */
  eventVersion: string;
  /** Logger namespace suffix (e.g., "start-experiment-run") */
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
 * Creates a command handler function for experiment run commands.
 * Uses composition to share common logic across different command types.
 *
 * @param config - Configuration for this command handler
 * @returns A command handler that processes commands and emits events
 */
export function createExperimentRunCommandHandler<
  TCommandData extends { tenantId: string; runId: string; occurredAt: number },
  TEvent extends ExperimentRunProcessingEvent,
  TEventData,
>(
  config: ExperimentRunCommandConfig<TCommandData, TEventData>,
): CommandHandler<
  Command<TCommandData>,
  ExperimentRunProcessingEvent
>["handle"] {
  const logger = createLogger(
    `langwatch:experiment-run-processing:${config.loggerName}`,
  );

  return async (
    command: Command<TCommandData>,
  ): Promise<ExperimentRunProcessingEvent[]> => {
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

    const event = EventUtils.createEvent<TEvent>({
      aggregateType: "experiment_run",
      aggregateId: runId,
      tenantId,
      type: config.eventType as TEvent["type"],
      version: config.eventVersion as TEvent["version"],
      data: config.mapToEventData(commandData) as TEvent["data"],
      occurredAt: commandData.occurredAt,
    });

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
