import { z } from "zod";
import { type CommandType, CommandTypeSchema } from "../domain/commandType";
import { type TenantId, TenantIdSchema } from "../domain/tenantId";
import type { Event } from "../domain/types";

/**
 * Zod schema for Command objects.
 * Commands represent intent to change system state and are processed by command handlers to produce events.
 */
export const CommandSchema = z.object({
  /**
   * Tenant identifier for multi-tenant systems.
   * REQUIRED - all commands must be scoped to a specific tenant for security.
   */
  tenantId: TenantIdSchema,
  /**
   * Identifier for the aggregate this command targets.
   * Often the same identifier used for the events/projection it will produce.
   */
  aggregateId: z.string(),
  /**
   * Command type used for routing and processing.
   * Example: "trace.reprocess", "user.create".
   */
  type: CommandTypeSchema,
  /**
   * Command-specific payload.
   * Commands should be explicit, stable contracts between callers and handlers.
   */
  data: z.unknown(),
  /**
   * Optional metadata about the command, such as correlation IDs or trace context.
   */
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Base command type inferred from CommandSchema.
 */
type CommandBase = z.infer<typeof CommandSchema>;

/**
 * Generic command type with type-safe payload and metadata.
 * Commands represent intent to change system state and are processed by command handlers to produce events.
 */
export type Command<
  Payload = unknown,
  Metadata = Record<string, unknown>,
> = Omit<CommandBase, "data" | "metadata"> & {
  /**
   * Command-specific payload.
   * Commands should be explicit, stable contracts between callers and handlers.
   */
  data: Payload;
  /**
   * Optional metadata about the command, such as correlation IDs or trace context.
   */
  metadata?: Metadata;
};

/**
 * Result of a command handler execution.
 * Command handlers must return events that will be stored by the framework.
 */
export type CommandHandlerResult<EventType extends Event = Event> =
  | Promise<EventType[]>
  | EventType[];

export interface CommandHandler<
  TCommand extends Command = Command,
  EventType extends Event = Event,
> {
  /**
   * Processes a command, typically by validating state and emitting one or more events.
   * This interface is intentionally generic and agnostic of storage or transport.
   *
   * @param command - The command to handle
   * @returns Promise that resolves to an array of events to be stored
   *
   * **Note:** Handlers are typically async because they need to:
   * - Fetch current state from stores
   * - Validate business rules
   * - Create and return events (framework will store them)
   */
  handle(command: TCommand): CommandHandlerResult<EventType>;
}

/**
 * Validates a command using the CommandSchema.
 * Useful for validating commands from external sources (e.g., API requests).
 *
 * @param command - The command to validate
 * @returns The validated command
 * @throws {z.ZodError} If the command is invalid
 */
export function validateCommand(
  command: unknown,
): z.infer<typeof CommandSchema> {
  return CommandSchema.parse(command);
}

/**
 * Creates a command with type-safe payload and metadata.
 *
 * This function does not perform runtime validation because it receives already-validated types
 * (TenantId, CommandType) as parameters. For validating commands from external sources, use validateCommand().
 *
 * @param tenantId - Tenant identifier for multi-tenant isolation
 * @param aggregateId - The aggregate this command targets
 * @param type - Command type identifier
 * @param data - Command-specific payload
 * @param metadata - Optional metadata (e.g., correlation IDs, trace context)
 * @returns A new command object
 */
export function createCommand<
  Payload = unknown,
  Metadata = Record<string, unknown>,
>(
  tenantId: TenantId,
  aggregateId: string,
  type: CommandType,
  data: Payload,
  metadata?: Metadata,
): Command<Payload, Metadata> {
  return {
    tenantId,
    aggregateId,
    type,
    data,
    metadata,
  };
}
