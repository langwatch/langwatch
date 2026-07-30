import type { z } from "zod";
import type { AggregateType } from "../domain/aggregateType";
import type { CommandType } from "../domain/commandType";
import type { EventType } from "../domain/eventType";
import { createTenantId } from "../domain/tenantId";
import type { Event } from "../domain/types";
import { EventUtils } from "../utils/event.utils";
import type { Command, CommandHandler, CommandHandlerResult } from "./command";
import type { CommandEnvelope } from "./commandEnvelope";
import { stripEnvelope, withCommandEnvelope } from "./commandEnvelope";
import type { CommandHandlerClass } from "./commandHandlerClass";
import { defineCommandSchema } from "./commandSchema";

/**
 * Return type of defineCommand().
 * Uses Event (base) for the event type parameter so commands are compatible with
 * any pipeline event union (covariant event type).
 */
export type DefinedCommandClass<
  TCommandData,
  TCmdType extends CommandType,
> = CommandHandlerClass<TCommandData, TCmdType, Event>;

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
 * `idempotencyKey` is the ONLY key a command declares, and it is a
 * storage-level guarantee: the event store drops a second event carrying a key
 * it has already appended, so a redelivered command is absorbed after the
 * handler runs. It does not stop the job from being enqueued or handled.
 *
 * Suppressing the *enqueue* is a separate, opt-in decision that belongs to the
 * pipeline wiring, not to the command: pass `deduplication: { makeId, ttlMs }`
 * to `.withCommand(…)` / `.withCommandInstance(…)`. It needs a TTL and a
 * squash policy, and whether collapsing two dispatches is correct depends on
 * the queue's traffic — which the command cannot know. Four commands opt in
 * today (`recordSpan`, `executeEvaluation`, `recordTopics`,
 * `reportUsageForMonth`); every other command runs every job it is handed.
 *
 * @example
 * ```typescript
 * export const QueueRunCommand = defineCommand({
 *   commandType: "lw.simulation_run.queue",
 *   eventType: "lw.simulation_run.queued",
 *   eventVersion: "2026-03-08",
 *   aggregateType: "simulation_run",
 *   schema: simulationRunQueuedEventDataSchema,
 *   aggregateId: (d) => d.scenarioRunId,
 *   idempotencyKey: (d) => `${d.tenantId}:${d.scenarioRunId}:queueRun`,
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
  groupKey,
  spanAttributes,
}: {
  commandType: TCmdType;
  eventType: TEvtType;
  eventVersion: string;
  aggregateType: AggregateType;
  schema: TEventDataSchema;
  aggregateId: (data: z.infer<TEventDataSchema> & CommandEnvelope) => string;
  idempotencyKey: (data: z.infer<TEventDataSchema> & CommandEnvelope) => string;
  groupKey?: (data: z.infer<TEventDataSchema> & CommandEnvelope) => string;
  spanAttributes?: (
    data: z.infer<TEventDataSchema> & CommandEnvelope,
  ) => Record<string, string | number | boolean>;
}): DefinedCommandClass<z.infer<TEventDataSchema> & CommandEnvelope, TCmdType> {
  type CommandData = z.infer<TEventDataSchema> & CommandEnvelope;

  const commandDataSchema = withCommandEnvelope(schema);

  const cmdSchema = defineCommandSchema(commandType, commandDataSchema);

  class DefinedCommand implements CommandHandler<Command<CommandData>, Event> {
    static readonly schema = cmdSchema;

    static getAggregateId(payload: CommandData): string {
      return aggregateId(payload);
    }

    static getGroupKey: ((payload: CommandData) => string) | undefined =
      groupKey;

    static getSpanAttributes:
      | ((payload: CommandData) => Record<string, string | number | boolean>)
      | undefined = spanAttributes;

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

  // Cast required: TypeScript cannot unify a class expression's constructor signature
  // with the intersection type `CommandHandlerClassStatic & (new () => CommandHandler)`.
  // The inner class structurally satisfies DefinedCommandClass but TS needs the
  // intermediate `unknown` to bridge the nominal gap between class literals and
  // intersection constructor types.
  return DefinedCommand as unknown as DefinedCommandClass<
    CommandData,
    TCmdType
  >;
}
