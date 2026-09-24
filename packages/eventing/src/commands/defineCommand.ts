import type { z } from "zod";

import type { AggregateType } from "../domain/aggregateType.ts";
import type { CommandType } from "../domain/commandType.ts";
import type { EventType } from "../domain/eventType.ts";
import { createTenantId } from "../domain/tenantId.ts";
import type { Event } from "../domain/types.ts";
import { EventUtils } from "../utils/event.utils.ts";
import type { Command, CommandHandler, CommandHandlerResult } from "./command.ts";
import type { CommandEnvelope } from "./commandEnvelope.ts";
import { stripEnvelope, withCommandEnvelope } from "./commandEnvelope.ts";
import type { CommandHandlerClass } from "./commandHandlerClass.ts";
import { defineCommandSchema } from "./commandSchema.ts";

/** The event a defined command produces: its declared type, version and the schema's data. */
export type DefinedCommandEvent<
  TEvtType extends EventType,
  TVersion extends string,
  TAggType extends AggregateType,
  TCommandData extends CommandEnvelope,
> = Omit<Event<Omit<TCommandData, keyof CommandEnvelope>>, "type" | "version" | "aggregateType"> & {
  type: TEvtType;
  version: TVersion;
  aggregateType: TAggType;
};

/** A command class that declares the one event it produces; `withCommand` checks it (§9). */
export type DefinedCommandClass<
  TCommandData,
  TCmdType extends CommandType,
  TEvent extends Event,
> = CommandHandlerClass<TCommandData, TCmdType, TEvent> & {
  makeJobId?: (data: TCommandData) => string;
};

/**
 * Defines a command handler class from a Zod event data schema.
 * Envelope fields (tenantId, occurredAt, idempotencyKey) are auto-merged.
 */
export function defineCommand<
  TEventDataSchema extends z.ZodObject<z.ZodRawShape>,
  TCmdType extends CommandType,
  TEvtType extends EventType,
  TVersion extends string,
  TAggType extends AggregateType,
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
  makeJobId,
}: {
  commandType: TCmdType;
  eventType: TEvtType;
  eventVersion: TVersion;
  aggregateType: TAggType;
  schema: TEventDataSchema;
  aggregateId: (data: z.infer<TEventDataSchema> & CommandEnvelope) => string;
  idempotencyKey: (data: z.infer<TEventDataSchema> & CommandEnvelope) => string;
  groupKey?: (data: z.infer<TEventDataSchema> & CommandEnvelope) => string;
  spanAttributes?: (
    data: z.infer<TEventDataSchema> & CommandEnvelope,
  ) => Record<string, string | number | boolean>;
  makeJobId?: (data: z.infer<TEventDataSchema> & CommandEnvelope) => string;
}): DefinedCommandClass<
  z.infer<TEventDataSchema> & CommandEnvelope,
  TCmdType,
  DefinedCommandEvent<TEvtType, TVersion, TAggType, z.infer<TEventDataSchema> & CommandEnvelope>
> {
  type CommandData = z.infer<TEventDataSchema> & CommandEnvelope;
  type ProducedEvent = DefinedCommandEvent<TEvtType, TVersion, TAggType, CommandData>;

  const commandDataSchema = withCommandEnvelope(schema);

  const cmdSchema = defineCommandSchema(commandType, commandDataSchema);

  class DefinedCommand implements CommandHandler<Command<CommandData>, ProducedEvent> {
    static readonly schema = cmdSchema;

    static getAggregateId(payload: CommandData): string {
      return aggregateId(payload);
    }

    static getGroupKey: ((payload: CommandData) => string) | undefined = groupKey;

    static getSpanAttributes:
      | ((payload: CommandData) => Record<string, string | number | boolean>)
      | undefined = spanAttributes;

    static makeJobId: ((payload: CommandData) => string) | undefined = makeJobId;

    handle(command: Command<CommandData>): CommandHandlerResult<ProducedEvent> {
      const { tenantId: tenantIdStr, data: commandData } = command;
      const tenantId = createTenantId(tenantIdStr);

      const eventData = stripEnvelope(commandData);

      const event = EventUtils.createEvent<ProducedEvent>({
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
  return DefinedCommand as unknown as DefinedCommandClass<CommandData, TCmdType, ProducedEvent>;
}
