import type { z } from "zod";
import type { AggregateType } from "../domain/aggregateType";
import type { CommandType } from "../domain/commandType";
import type { EventType } from "../domain/eventType";
import { createTenantId } from "../domain/tenantId";
import type { Event } from "../domain/types";
import type { Command, CommandHandler, CommandHandlerResult } from "./command";
import type { CommandHandlerClass } from "./commandHandlerClass";
import { withCommandEnvelope, stripEnvelope } from "./commandEnvelope";
import type { CommandEnvelope } from "./commandEnvelope";
import { defineCommandSchema } from "./commandSchema";
import { EventUtils } from "../utils/event.utils";

/**
 * Return type of defineCommand() — extends CommandHandlerClass with optional makeJobId.
 * Uses Event (base) for the event type parameter so commands are compatible with
 * any pipeline event union (covariant event type).
 */
export type DefinedCommandClass<
  TCommandData,
  TCmdType extends CommandType,
> = CommandHandlerClass<TCommandData, TCmdType, Event> & {
  makeJobId?: (data: TCommandData) => string;
};

/**
 * Defines a pure command handler class from a Zod event data schema.
 *
 * The command data schema is auto-derived by merging envelope fields (tenantId,
 * occurredAt, idempotencyKey) into the event data schema. The handle() method
 * strips envelope fields and creates an event with EventUtils.createEvent().
 *
 * Returns a class with a zero-arg constructor, satisfying queueManager's
 * `new handlerClass()` constraint.
 *
 * @example
 * ```typescript
 * export const StartSuiteRunCommand = defineCommand({
 *   commandType: "lw.suite_run.start",
 *   eventType: "lw.suite_run.started",
 *   eventVersion: "2026-03-01",
 *   aggregateType: "suite_run",
 *   schema: suiteRunStartedEventDataSchema,
 *   aggregateId: (d) => d.batchRunId,
 *   idempotencyKey: (d) => `${d.tenantId}:${d.batchRunId}:${d.idempotencyKey}`,
 * });
 * ```
 */
export function defineCommand<
  TEventDataSchema extends z.ZodObject<z.ZodRawShape>,
  TCmdType extends CommandType,
  TEvtType extends EventType,
>({
  commandType,
  eventType,
  eventVersion,
  aggregateType,
  schema,
  aggregateId,
  idempotencyKey,
  spanAttributes,
  makeJobId,
}: {
  commandType: TCmdType;
  eventType: TEvtType;
  eventVersion: string;
  aggregateType: AggregateType;
  schema: TEventDataSchema;
  aggregateId: (data: z.infer<TEventDataSchema> & CommandEnvelope) => string;
  idempotencyKey: (data: z.infer<TEventDataSchema> & CommandEnvelope) => string;
  spanAttributes?: (data: z.infer<TEventDataSchema> & CommandEnvelope) => Record<string, string | number | boolean>;
  makeJobId?: (data: z.infer<TEventDataSchema> & CommandEnvelope) => string;
}): DefinedCommandClass<z.infer<TEventDataSchema> & CommandEnvelope, TCmdType> {
  type CommandData = z.infer<TEventDataSchema> & CommandEnvelope;

  const commandDataSchema = withCommandEnvelope(schema);

  const cmdSchema = defineCommandSchema(
    commandType,
    commandDataSchema,
  );

  class DefinedCommand implements CommandHandler<Command<CommandData>, Event> {
    static readonly schema = cmdSchema;

    static getAggregateId(payload: CommandData): string {
      return aggregateId(payload);
    }

    static getSpanAttributes: ((payload: CommandData) => Record<string, string | number | boolean>) | undefined =
      spanAttributes;

    static makeJobId: ((payload: CommandData) => string) | undefined =
      makeJobId;

    handle(command: Command<CommandData>): CommandHandlerResult<Event> {
      const { tenantId: tenantIdStr, data: commandData } = command;
      const tenantId = createTenantId(tenantIdStr);

      const eventData = stripEnvelope(commandData);

      const event = EventUtils.createEvent({
        aggregateType,
        aggregateId: aggregateId(commandData),
        tenantId,
        type: eventType,
        version: eventVersion,
        data: eventData,
        occurredAt: commandData.occurredAt,
        idempotencyKey: idempotencyKey(commandData),
      });

      return [event];
    }
  }

  return DefinedCommand as unknown as DefinedCommandClass<CommandData, TCmdType>;
}
