import type { createLogger } from "~/utils/logger/server";
import { mapZodIssuesToLogContext } from "~/utils/zod";
import type { FeatureFlagServiceInterface } from "../../../featureFlag/types";
import type { Command, CommandHandler } from "../../commands/command";
import { createCommand } from "../../commands/command";
import type { CommandSchema } from "../../commands/commandSchema";
import type { AggregateType } from "../../domain/aggregateType";
import type { CommandType } from "../../domain/commandType";
import { createTenantId } from "../../domain/tenantId";
import type { TenantId } from "../../domain/tenantId";
import type { Event } from "../../domain/types";
import { EventSchema } from "../../domain/types";
import type { KillSwitchOptions } from "../../pipeline/staticBuilder.types";
import type { DeduplicationStrategy } from "../../queues";
import type { EventStoreReadContext } from "../../stores/eventStore.types";
import { EventUtils } from "../../utils/event.utils";
import { isComponentDisabled } from "../../utils/killSwitch";
import { ValidationError } from "../errorHandling";

/**
 * Constraint interface for payloads that support command processing.
 * All command payloads must include a tenantId for tenant isolation
 * and occurredAt for global FIFO ordering.
 */
interface BaseCommandPayload {
  tenantId: TenantId | string;
  occurredAt: number;
}

/**
 * Parameters for the extracted processCommand function.
 */
export interface ProcessCommandParams<EventType extends Event> {
  payload: Record<string, unknown>;
  commandType: CommandType;
  commandSchema: CommandSchema<any, CommandType>;
  handler: CommandHandler<Command<any>, EventType>;
  getAggregateId: (payload: any) => string;
  storeEventsFn: (
    events: EventType[],
    context: EventStoreReadContext<EventType>,
  ) => Promise<void>;
  aggregateType: AggregateType;
  commandName: string;
  featureFlagService?: FeatureFlagServiceInterface;
  killSwitchOptions?: KillSwitchOptions;
  logger?: ReturnType<typeof createLogger>;
}

/**
 * Processes a command: validates the payload, checks kill switch, invokes the handler,
 * validates resulting events, and stores them.
 *
 * Extracted from createCommandDispatcher to allow reuse in shared command queues.
 */
export async function processCommand<EventType extends Event>(
  params: ProcessCommandParams<EventType>,
): Promise<void> {
  const {
    payload,
    commandType,
    commandSchema,
    handler,
    getAggregateId,
    storeEventsFn,
    aggregateType,
    commandName,
    featureFlagService,
    killSwitchOptions,
    logger: log,
  } = params;

  const validation = commandSchema.validate(payload);
  if (!validation.success) {
    throw new ValidationError(
      `Invalid payload for command type "${commandType}". Validation failed.`,
      "payload",
      undefined,
      {
        commandType,
        zodIssues: mapZodIssuesToLogContext(validation.error.issues),
      },
    );
  }

  const validated = validation.data;
  const tenantId = createTenantId(String(validated.tenantId));
  const aggregateId = getAggregateId(validated);

  const disabled = await isComponentDisabled({
    featureFlagService,
    aggregateType,
    componentType: "command",
    componentName: commandName,
    tenantId,
    customKey: killSwitchOptions?.customKey,
    logger: log,
  });
  if (disabled) {
    return;
  }

  const command = createCommand(
    tenantId,
    aggregateId,
    commandType,
    validated,
  );

  const events = await handler.handle(command);

  if (!events) {
    throw new ValidationError(
      `Command handler for "${commandType}" returned undefined. Handler must return an array of events.`,
      "events",
      void 0,
      { commandType },
    );
  }

  if (!Array.isArray(events)) {
    throw new ValidationError(
      `Command handler for "${commandType}" returned a non-array value. Handler must return an array of events, but got: ${typeof events}`,
      "events",
      undefined,
      { commandType },
    );
  }

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event) {
      throw new ValidationError(
        `Command handler for "${commandType}" returned an array with undefined at index ${i}. All events must be defined.`,
        "events",
        undefined,
        { commandType, index: i },
      );
    }

    if (!EventUtils.isValidEvent(event)) {
      const parseResult = EventSchema.safeParse(event);
      const validationError =
        parseResult.success === false
          ? `Validation errors: ${parseResult.error.issues
              .map(
                (issue: any) => `${issue.path.join(".")}: ${issue.message}`,
              )
              .join(", ")}`
          : "Unknown validation error";

      throw new ValidationError(
        `Command handler for "${commandType}" returned an invalid event at index ${i}. Event must have id, aggregateId, timestamp, type, and data. ${validationError}.`,
        "events",
        undefined,
        {
          commandType,
          index: i,
          zodIssues:
            parseResult.success === false
              ? mapZodIssuesToLogContext(parseResult.error.issues)
              : void 0,
        },
      );
    }
  }

  if (events.length > 0) {
    await storeEventsFn(events, { tenantId });
  }
}

/**
 * Options for configuring a command handler.
 */
export interface CommandHandlerOptions<Payload> {
  getAggregateId?: (payload: Payload) => string;
  delay?: number;
  deduplication?: DeduplicationStrategy<Payload>;
  concurrency?: number;
  /** Maximum number of groups processed in parallel (GroupQueue only). */
  globalConcurrency?: number;
  spanAttributes?: (
    payload: Payload,
  ) => Record<string, string | number | boolean>;
  killSwitch?: KillSwitchOptions;
}

