import type { CommandType } from "./commandType";
import type { TenantId } from "./tenantId";

export interface Command<
  AggregateId = string,
  Payload = unknown,
  Metadata = Record<string, unknown>,
  TTenantId extends TenantId = TenantId,
> {
  /**
   * Tenant identifier for multi-tenant systems.
   * REQUIRED - all commands must be scoped to a specific tenant for security.
   */
  tenantId: TTenantId;
  /**
   * Identifier for the aggregate this command targets.
   * Often the same identifier used for the events/projection it will produce.
   */
  aggregateId: AggregateId;
  /**
   * Command type used for routing and processing.
   * Example: "trace.reprocess", "user.create".
   */
  type: CommandType;
  /**
   * Command-specific payload.
   * Commands should be explicit, stable contracts between callers and handlers.
   */
  data: Payload;
  /**
   * Optional metadata about the command, such as correlation IDs or trace context.
   */
  metadata?: Metadata;
}

export type CommandHandlerResult = Promise<void> | void;

export interface CommandHandler<
  AggregateId = string,
  TCommand extends Command<AggregateId> = Command<AggregateId>,
> {
  /**
   * Processes a command, typically by validating state and emitting one or more events.
   * This interface is intentionally generic and agnostic of storage or transport.
   *
   * @param command - The command to handle
   * @returns Promise that resolves to the handler result (void or events)
   *
   * **Note:** Handlers are typically async because they need to:
   * - Fetch current state from stores
   * - Validate business rules
   * - Emit events to event stores
   */
  handle(command: TCommand): Promise<CommandHandlerResult>;
}

export function createCommand<
  AggregateId = string,
  Payload = unknown,
  Metadata = Record<string, unknown>,
>(
  tenantId: TenantId,
  aggregateId: AggregateId,
  type: CommandType,
  data: Payload,
  metadata?: Metadata,
): Command<AggregateId, Payload, Metadata> {
  return {
    tenantId,
    aggregateId,
    type,
    data,
    metadata,
  };
}
