import type { CommandType } from "../domain/commandType";
import type { Event } from "../domain/types";
import type { Command, CommandHandler } from "./command";
import type { CommandSchema } from "./commandSchema";

/**
 * Static properties and methods that must be defined on a CommandHandlerClass.
 * These are accessed via the constructor (class) rather than instances.
 */
export interface CommandHandlerClassStatic<Payload, Type extends CommandType> {
  /**
   * Command schema for validation and type safety.
   * Must be a static readonly property.
   */
  readonly schema: CommandSchema<Payload, Type>;

  /**
   * Dispatcher name for this command handler.
   * Used to access the command dispatcher via `pipeline.commands.{dispatcherName}`.
   * Must be a static readonly property with a string literal type.
   */
  readonly dispatcherName: string;

  /**
   * Extract the aggregate ID from the command payload.
   * Required - used for routing and event storage.
   */
  getAggregateId(payload: Payload): string;

  /**
   * Optional: Extract span attributes from the payload for observability.
   */
  getSpanAttributes?(
    payload: Payload,
  ): Record<string, string | number | boolean>;

  /**
   * Optional: Generate a custom job ID for idempotency.
   * Default: `${tenantId}:${aggregateId}:${timestamp}:${commandType}`
   */
  makeJobId?(payload: Payload): string;

  /**
   * Optional: Delay in milliseconds before processing the command.
   */
  delay?: number;

  /**
   * Optional: Concurrency limit for processing commands.
   */
  concurrency?: number;
}

/**
 * Self-contained command handler class that bundles schema, handler, and configuration.
 *
 * This design allows pipeline registration by simply passing the class, eliminating the need
 * to separately configure schema, handler, and routing logic. The framework extracts all
 * necessary information from static properties and methods.
 *
 * @example
 * ```typescript
 * class MyCommandHandler implements CommandHandler<string, Command<string, MyPayload>, MyEvent> {
 *   static readonly schema = defineCommandSchema<MyPayload>(
 *     "my.command.type",
 *     (payload): payload is MyPayload => { ... }
 *   );
 *
 *   static getAggregateId(payload: MyPayload): string {
 *     return payload.id;
 *   }
 *
 *   static getSpanAttributes(payload: MyPayload) {
 *     return { "payload.id": payload.id };
 *   }
 *
 *   static makeJobId(payload: MyPayload): string {
 *     return `${payload.tenantId}:${payload.id}`;
 *   }
 *
 *   async handle(command: Command<string, MyPayload>): Promise<MyEvent[]> {
 *     // Handler implementation
 *   }
 * }
 * ```
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
  T extends CommandHandlerClass<infer Payload, any, any> ? Payload : never;

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

/**
 * Type helper to extract the dispatcher name from a CommandHandlerClass.
 */
export type ExtractCommandHandlerDispatcherName<T> = T extends {
  dispatcherName: infer Name;
}
  ? Name extends string
    ? Name
    : never
  : never;
