import { createLogger } from "../../../../../utils/logger";
import type { Command, CommandHandler } from "../../../library";
import { createTenantId, EventUtils } from "../../../library";
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
  /** Job ID suffix (e.g., "schedule", "start", "complete") */
  jobIdSuffix: string;
  /** Maps command data to event data */
  mapToEventData: (commandData: TCommandData) => TEventData;
  /** Extracts additional log context from command data */
  getLogContext: (commandData: TCommandData) => Record<string, unknown>;
}

/**
 * Abstract base class for evaluation command handlers.
 * Eliminates duplication by providing common handle() logic while allowing
 * subclasses to specify event-specific configuration.
 */
export abstract class BaseEvaluationCommand<
  TCommandData extends { tenantId: string; evaluationId: string },
  TEvent extends EvaluationProcessingEvent,
  TEventData,
> implements CommandHandler<Command<TCommandData>, EvaluationProcessingEvent>
{
  protected abstract readonly config: EvaluationCommandConfig<
    TCommandData,
    TEventData
  >;

  protected getLogger(): ReturnType<typeof createLogger> {
    return createLogger(
      `langwatch:evaluation-processing:${this.config.loggerName}`
    );
  }

  async handle(
    command: Command<TCommandData>
  ): Promise<EvaluationProcessingEvent[]> {
    const logger = this.getLogger();
    const { tenantId: tenantIdStr, data: commandData } = command;
    const tenantId = createTenantId(tenantIdStr);
    const { evaluationId } = commandData;

    logger.info(
      {
        tenantId,
        evaluationId,
        ...this.config.getLogContext(commandData),
      },
      this.config.handleLogMessage
    );

    const event = EventUtils.createEvent<TEvent>(
      "evaluation",
      evaluationId,
      tenantId,
      this.config.eventType as TEvent["type"],
      this.config.eventVersion as TEvent["version"],
      this.config.mapToEventData(commandData) as TEvent["data"]
    );

    logger.debug(
      {
        tenantId,
        evaluationId,
        eventId: event.id,
        eventType: event.type,
      },
      this.config.emitLogMessage
    );

    return [event];
  }

  /**
   * Create a unique job ID for deduplication.
   * Format: {tenantId}:{evaluationId}:{suffix}
   */
  static makeJobIdWithSuffix<
    T extends { tenantId: string; evaluationId: string },
  >(payload: T, suffix: string): string {
    return `${payload.tenantId}:${payload.evaluationId}:${suffix}`;
  }
}
