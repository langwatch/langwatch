import type { CommandType } from "../domain/commandType";
import type { Event } from "../domain/types";
import type { Command, CommandHandler } from "./command";
import type { CommandSchema } from "./commandSchema";

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
   * Optional: Extract span attributes from the payload for observability.
   */
  getSpanAttributes?(
    payload: Payload,
  ): Record<string, string | number | boolean>;

  /**
   * Optional: Static dispatcher name to use instead of the registration name.
   * If provided, this will be used as the command dispatcher name in the pipeline.
   */
  readonly dispatcherName?: string;
}

/**
 * Self-contained command handler class that bundles schema and handler.
 *
 * This design allows pipeline registration by simply passing the class, eliminating the need
 * to separately configure schema, handler, and routing logic. The framework extracts all
 * necessary information from static properties and methods.
 *
 * Configuration options (delay, concurrency, deduplication) should be provided via
 * registration options rather than static class properties.
 *
 * @example
 * ```typescript
 * import { z } from "zod";
 *
 * const myPayloadSchema = z.object({
 *   id: z.string(),
 *   data: z.string(),
 * });
 *
 * class MyCommandHandler implements CommandHandler<Command<z.infer<typeof myPayloadSchema>>, MyEvent> {
 *   static readonly schema = defineCommandSchema(
 *     "my.command.type",
 *     myPayloadSchema
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
 *   async handle(command: Command<MyPayload>): Promise<MyEvent[]> {
 *     // Handler implementation
 *   }
 * }
 *
 * // Register with options:
 * pipeline.withCommand("myCommand", MyCommandHandler, {
 *   delay: 1000,
 *   concurrency: 10,
 *   deduplication: {
 *     makeId: (payload) => `${payload.tenantId}:${payload.id}`,
 *   },
 * });
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
