export interface Command<
  AggregateId = string,
  Payload = unknown,
  Metadata = Record<string, unknown>,
> {
  /**
   * Identifier for the aggregate this command targets.
   * Often the same identifier used for the events/projection it will produce.
   */
  aggregateId: AggregateId;
  /**
   * Command type used for routing and processing.
   * Example: "trace.reprocess", "user.create".
   */
  type: string;
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
  CommandType extends Command<AggregateId> = Command<AggregateId>,
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
  handle(command: CommandType): Promise<CommandHandlerResult>;
}

export function createCommand<
  AggregateId = string,
  Payload = unknown,
  Metadata = Record<string, unknown>,
>(
  aggregateId: AggregateId,
  type: string,
  data: Payload,
  metadata?: Metadata,
): Command<AggregateId, Payload, Metadata> {
  return {
    aggregateId,
    type,
    data,
    metadata,
  };
}
