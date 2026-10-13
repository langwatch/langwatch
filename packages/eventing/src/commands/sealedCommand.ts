import type { CommandType } from "../domain/commandType.ts";
import type { Event } from "../domain/types.ts";
import type { CommandHandlerOptions } from "../pipeline/staticBuilder.types.ts";
import type { Command, CommandHandler } from "./command.ts";
import type { CommandHandlerClass, CommandHandlerClassStatic } from "./commandHandlerClass.ts";
import type { CommandSchema } from "./commandSchema.ts";

/** Every command payload names its tenant; the dispatcher scopes the command by it. */
export type TenantScopedPayload = { readonly tenantId: unknown };

/** A handler class whose payload is read from its schema alone; its other members accept it. */
export type SchemaTypedCommandClass<
  Payload extends TenantScopedPayload,
  Type extends CommandType,
  E extends Event,
> = { readonly schema: CommandSchema<Payload, Type> } & CommandHandlerClass<
  NoInfer<Payload>,
  NoInfer<Type>,
  E
>;

/** A command as registered: static half, handler factory and options, typed by one payload. */
export interface CommandRegistration<
  Payload extends TenantScopedPayload,
  Type extends CommandType,
  E extends Event,
> {
  readonly name: string;
  readonly handlerClassName: string;
  readonly handlerClass: CommandHandlerClassStatic<Payload, Type>;
  readonly createHandler: () => CommandHandler<Command<Payload>, E>;
  readonly options?: CommandHandlerOptions<Payload>;
}

/** Opens a command whose payload type was sealed in a closure at registration (ARCHITECTURE §9). */
export type OpenCommand<E extends Event = Event> = <R>(
  use: <Payload extends TenantScopedPayload, Type extends CommandType>(
    command: CommandRegistration<Payload, Type, E>,
  ) => R,
) => R;

/** What a sealed command shows without opening it; its payload-typed options cannot be called. */
export interface SealedCommandDefinition {
  readonly name: string;
  readonly handlerClassName: string;
  readonly options?: CommandHandlerOptions<never>;
}

export interface SealedCommand<E extends Event = Event> {
  readonly definition: SealedCommandDefinition;
  readonly open: OpenCommand<E>;
}

export function sealCommand<
  Payload extends TenantScopedPayload,
  Type extends CommandType,
  E extends Event,
>(command: CommandRegistration<Payload, Type, E>): SealedCommand<E> {
  return {
    definition: {
      name: command.name,
      handlerClassName: command.handlerClassName,
      options: command.options,
    },
    open: (use) => use(command),
  };
}

/** Seals a handler class constructed with no arguments when its queue is registered. */
export function sealCommandClass<
  Payload extends TenantScopedPayload,
  Type extends CommandType,
  E extends Event,
>({
  name,
  handlerClass,
  options,
}: {
  name: string;
  handlerClass: SchemaTypedCommandClass<Payload, Type, E>;
  options?: CommandHandlerOptions<Payload>;
}): SealedCommand<E> {
  return sealCommand({
    name,
    handlerClassName: handlerClass.name,
    handlerClass,
    createHandler: () => new handlerClass(),
    options,
  });
}
