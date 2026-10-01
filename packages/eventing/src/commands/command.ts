import { z } from "zod";

import { type CommandType, CommandTypeSchema } from "../domain/commandType.ts";
import { type TenantId, TenantIdSchema } from "../domain/tenantId.ts";
import type { Event } from "../domain/types.ts";

/**
 * Zod schema for Command objects processed by command handlers.
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
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Base command type inferred from CommandSchema.
 */
type CommandBase = z.infer<typeof CommandSchema>;

/**
 * Generic command type with type-safe payload and metadata.
 */
export type Command<Payload = unknown, Metadata = Record<string, unknown>> = Omit<
  CommandBase,
  "data" | "metadata"
> & {
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
   * Processes a command by validating state and emitting events.
   * @param command - The command to handle
   * @returns Array of events to be stored
   */
  handle: (command: TCommand) => CommandHandlerResult<EventType>;

  /**
   * Optional post-store cleanup hook, invoked after events are persisted. See ADR-022.
   */
  cleanupAfterStore?(command: TCommand): Promise<void>;
}

/**
 * Validates a command using the CommandSchema.
 * Useful for validating commands from external sources (e.g., API requests).
 *
 * @param command - The command to validate
 * @returns The validated command
 * @throws {z.ZodError} If the command is invalid
 */
export function validateCommand(command: unknown): z.infer<typeof CommandSchema> {
  return CommandSchema.parse(command);
}

/**
 * Creates a type-safe command. No runtime validation—pass pre-validated types only.
 */
export function createCommand<Payload = unknown, Metadata = Record<string, unknown>>({
  tenantId,
  aggregateId,
  type,
  data,
  metadata,
}: {
  tenantId: TenantId;
  aggregateId: string;
  type: CommandType;
  data: Payload;
  metadata?: Metadata;
}): Command<Payload, Metadata> {
  return {
    tenantId,
    aggregateId,
    type,
    data,
    metadata,
  };
}
