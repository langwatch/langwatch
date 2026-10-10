import type { CommandType } from "../domain/commandType.ts";
import type { Event } from "../domain/types.ts";
import type { Command, CommandHandler } from "./command.ts";
import type { CommandSchema } from "./commandSchema.ts";

/**
 * Static properties and methods that must be defined on a CommandHandlerClass,
 * accessed via the constructor rather than instances. Options like delay and
 * deduplication belong in registration (`.withCommand`), not static properties.
 */
export interface CommandHandlerClassStatic<Payload, Type extends CommandType> {
  /**
   * Command schema for validation and type safety.
   * Must be a static readonly property.
   */
  readonly schema: CommandSchema<Payload, Type>;

  /**
   * Extract the aggregate ID from the command payload.
   * Required - used for routing and event storage.
   */
  getAggregateId(payload: Payload): string;

  /**
   * Optional: Extract a custom group key from the command payload for queue routing.
   * When provided, enables per-item parallelism instead of per-aggregate serialization.
   * Falls back to getAggregateId when not defined.
   */
  getGroupKey?(payload: Payload): string;

  /**
   * Optional: Extract span attributes from the payload for observability.
   */
  getSpanAttributes?: (payload: Payload) => Record<string, string | number | boolean>;

  /**
   * Optional: Static dispatcher name to use instead of the registration name.
   * If provided, this will be used as the command dispatcher name in the pipeline.
   */
  readonly dispatcherName?: string;
}

/**
 * Self-contained command handler class that bundles schema and handler together.
 * Register with pipeline.withCommand() passing the class and optional config.
 */
export type CommandHandlerClass<
  Payload,
  Type extends CommandType,
  EventType extends Event,
> = CommandHandlerClassStatic<Payload, Type> &
  (new () => CommandHandler<Command<Payload>, EventType>);

/**
 * Type helper to extract the payload type from a CommandHandlerClass.
 */
export type ExtractCommandHandlerPayload<T> =
  T extends CommandHandlerClass<infer Payload, infer _Type, infer _Event>
    ? Payload
    : T extends CommandHandlerClassStatic<infer Payload, infer _Type>
      ? Payload
      : never;

/**
 * Type helper to extract the command type from a CommandHandlerClass.
 */
export type ExtractCommandHandlerType<T> =
  T extends CommandHandlerClass<infer _Payload, infer Type, infer _Event> ? Type : never;

/**
 * Type helper to extract the event type from a CommandHandlerClass.
 */
export type ExtractCommandHandlerEvent<T> =
  T extends CommandHandlerClass<infer _Payload, infer _Type, infer EventType> ? EventType : never;
