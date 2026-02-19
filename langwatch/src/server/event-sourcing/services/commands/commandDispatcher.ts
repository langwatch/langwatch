import type { createLogger } from "~/utils/logger/server";
import { mapZodIssuesToLogContext } from "~/utils/zod";
import type { FeatureFlagServiceInterface } from "../../../featureFlag/types";
import type { Command, CommandHandler } from "../../commands/command";
import { createCommand } from "../../commands/command";
import type { CommandSchema } from "../../commands/commandSchema";
import type { AggregateType } from "../../domain/aggregateType";
import type { CommandType } from "../../domain/commandType";
import type { TenantId } from "../../domain/tenantId";
import { createTenantId } from "../../domain/tenantId";
import type { Event } from "../../domain/types";
import { EventSchema } from "../../domain/types";
import type { KillSwitchOptions } from "../../pipeline/staticBuilder.types";
import type {
  DeduplicationStrategy,
  EventSourcedQueueProcessor,
  QueueProcessorFactory,
} from "../../queues";
import { resolveDeduplicationStrategy } from "../../queues";
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
 * Options for configuring a command handler.
 */
export interface CommandHandlerOptions<Payload> {
  getAggregateId?: (payload: Payload) => string;
  delay?: number;
  deduplication?: DeduplicationStrategy<Payload>;
  concurrency?: number;
  spanAttributes?: (
    payload: Payload,
  ) => Record<string, string | number | boolean>;
  killSwitch?: KillSwitchOptions;
}

/**
 * Creates a command dispatcher that processes commands and stores resulting events.
 */
export function createCommandDispatcher<
  Payload extends BaseCommandPayload & Record<string, unknown>,
  EventType extends Event,
>({
  commandType,
  commandSchema,
  handler,
  options,
  getAggregateId,
  queueName,
  storeEventsFn,
  factory,
  aggregateType,
  commandName,
  featureFlagService,
  killSwitchOptions,
  logger,
}: {
  commandType: CommandType;
  commandSchema: CommandSchema<Payload, CommandType>;
  handler: CommandHandler<Command<Payload>, EventType>;
  options: CommandHandlerOptions<Payload>;
  getAggregateId: (payload: Payload) => string;
  queueName: string;
  storeEventsFn: (
    events: EventType[],
    context: EventStoreReadContext<EventType>,
  ) => Promise<void>;
  factory: QueueProcessorFactory;
  aggregateType: AggregateType;
  commandName: string;
  featureFlagService?: FeatureFlagServiceInterface;
  killSwitchOptions?: KillSwitchOptions;
  logger?: ReturnType<typeof createLogger>;
}): EventSourcedQueueProcessor<Payload> {
  const buildCommandKey = (payload: Payload): string => {
    const aggregateId = getAggregateId(payload);
    return `${String(payload.tenantId)}:${aggregateType}:${String(aggregateId)}`;
  };

  const processor = factory.create<Payload>({
    name: queueName,
    delay: options.delay,
    deduplication: resolveDeduplicationStrategy(
      options.deduplication,
      buildCommandKey,
    ),
    spanAttributes: options.spanAttributes,
    options: options.concurrency
      ? { concurrency: options.concurrency }
      : void 0,
    groupKey: buildCommandKey,
    score: (payload: Payload) => payload.occurredAt,
    async process(payload: Payload) {
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

      const tenantId = createTenantId(String(payload.tenantId));
      const aggregateId = getAggregateId(payload);

      const disabled = await isComponentDisabled({
        featureFlagService,
        aggregateType,
        componentType: "command",
        componentName: commandName,
        tenantId,
        customKey: killSwitchOptions?.customKey,
        logger,
      });
      if (disabled) {
        return;
      }

      const command = createCommand(
        tenantId,
        aggregateId,
        commandType,
        payload,
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
    },
  });

  return {
    async send(payload: Payload): Promise<void> {
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
      return processor.send(payload);
    },
    async sendBatch(payloads: Payload[]): Promise<void> {
      for (const payload of payloads) {
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
      }
      return processor.sendBatch(payloads);
    },
    async close(): Promise<void> {
      return processor.close();
    },
    async waitUntilReady(): Promise<void> {
      return processor.waitUntilReady();
    },
  };
}
