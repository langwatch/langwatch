import type { CommandType } from "../domain/commandType.ts";
import type { Event } from "../domain/types.ts";
import type { Command, CommandHandler } from "./command.ts";
import type { CommandSchema } from "./commandSchema.ts";

/**
 * Static properties and methods that must be defined on a CommandHandlerClass.
 * These are accessed via the constructor (class) rather than instances.
 *
 * Note: Configuration options like delay, concurrency, and deduplication should be
 * provided via registration options (e.g., `.withCommand("name", Handler, { delay: 1000 })`),
 * not as static class properties.
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
  getSpanAttributes?(payload: Payload): Record<string, string | number | boolean>;

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
  T extends CommandHandlerClass<infer Payload, any, any>
    ? Payload
    : T extends CommandHandlerClassStatic<infer Payload, any>
      ? Payload
      : never;

/**
 * Type helper to extract the command type from a CommandHandlerClass.
 */
export type ExtractCommandHandlerType<T> =
  T extends CommandHandlerClass<any, infer Type, any> ? Type : never;

/**
 * Type helper to extract the event type from a CommandHandlerClass.
 */
export type ExtractCommandHandlerEvent<T> =
  T extends CommandHandlerClass<any, any, infer EventType> ? EventType : never;
