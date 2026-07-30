import type { CommandDispatcher } from "../deferred";
import type { EventSourcedQueueProcessor, QueueSendOptions } from "../queues";
import { ConfigurationError } from "../services/errorHandling";
import type {
  CommandHandlerClassStatic,
  ExtractCommandHandlerPayload,
} from "./commandHandlerClass";

/**
 * Any command class the bus can key on.
 *
 * The constraint is `CommandHandlerClassStatic`, NOT `DefinedCommandClass`:
 * the latter is `CommandHandlerClass`, which
 * carries `new () => CommandHandler<…>` — a zero-argument constructor. The
 * commands registered through `.withCommandInstance` (`ExecuteEvaluationCommand`,
 * `ComputeRunMetricsCommand`, `ReportUsageForMonthCommand`) take constructor DI
 * and have no zero-arg constructor, so a `DefinedCommandClass` constraint would
 * silently exclude the cross-pipeline edges this bus exists for. The static
 * interface is the widest constraint that covers both registration paths, and
 * it is the same one `staticBuilder.withCommandInstance` uses.
 */
export type AnyCommandClass = CommandHandlerClassStatic<any, any>;

/**
 * Cross-pipeline command dispatch keyed on object identity (ADR-102).
 *
 * The imported command class *is* the key and *is* the type: no string keys,
 * no `declare module` augmentation, no central registry type to keep in sync.
 * Payloads come from `ExtractCommandHandlerPayload`, the same helper
 * `staticBuilder` uses, so the bus cannot drift from the builder.
 *
 * Resolution is lazy — it happens when a command is *sent*, not when a port is
 * bound — which is what removes pipeline registration order as a constraint.
 *
 * Pass the imported symbol directly. Storing a command class in a variable
 * annotated `AnyCommandClass` widens `C` and collapses the payload to `any`;
 * `__tests__/commandBus.type.test.ts` is the compile-time guard against that.
 */
export interface CommandBus {
  send<C extends AnyCommandClass>(
    command: C,
    data: ExtractCommandHandlerPayload<C>,
    options?: QueueSendOptions<ExtractCommandHandlerPayload<C>>,
  ): Promise<void>;

  sendBatch<C extends AnyCommandClass>(
    command: C,
    data: ExtractCommandHandlerPayload<C>[],
    options?: QueueSendOptions<ExtractCommandHandlerPayload<C>>,
  ): Promise<void>;

  /** Bind once, hand the result to a subscriber as a layer-4 port. */
  port<C extends AnyCommandClass>(
    command: C,
  ): CommandDispatcher<ExtractCommandHandlerPayload<C>>;
}

/**
 * The bus as the composition root holds it. Pipelines declare `CommandBus` in
 * their `Deps`, so `assertPortsResolvable` is not reachable from pipeline code.
 */
export interface CommandBusRuntime extends CommandBus {
  /**
   * Boot check: every port bound so far resolves to a registered dispatcher.
   *
   * `Deferred` threw on an unresolved *call*, never at boot — it only gave a
   * better error message. Calling this once after registration recovers the
   * startup guarantee everyone assumed `Deferred` provided, and it needs no
   * list to keep in sync: a port is recorded by the act of binding it, so any
   * pipeline that takes a port is covered automatically.
   */
  assertPortsResolvable(): void;
}

interface CommandBusDeps {
  /** Identity lookup. Called per dispatch so resolution stays lazy. */
  resolve: (
    command: AnyCommandClass,
  ) => EventSourcedQueueProcessor<any> | undefined;
  /** Command types currently resolvable, for the unresolved-command message. */
  registered: () => string[];
}

/**
 * The command type is used for error messages only — resolution is by object
 * identity and never touches a string.
 */
function describeCommand(command: AnyCommandClass): string {
  return command.dispatcherName ?? command.schema.type;
}

export function createCommandBus(deps: CommandBusDeps): CommandBusRuntime {
  const bound = new Set<AnyCommandClass>();

  const resolve = (
    command: AnyCommandClass,
  ): EventSourcedQueueProcessor<any> => {
    const dispatcher = deps.resolve(command);
    if (!dispatcher) {
      throw new ConfigurationError(
        "CommandBus",
        `command "${describeCommand(command)}" is not registered on any pipeline`,
        {
          command: describeCommand(command),
          registered: deps.registered(),
        },
      );
    }
    return dispatcher;
  };

  return {
    async send(command, data, options) {
      await resolve(command).send(data, options);
    },

    async sendBatch(command, data, options) {
      await resolve(command).sendBatch(data, options);
    },

    port(command) {
      bound.add(command);
      // Deliberately does NOT resolve here: binding a port before the owning
      // pipeline registers is legal, and that is the whole point.
      return (data, options) => resolve(command).send(data, options);
    },

    assertPortsResolvable() {
      const unresolved = Array.from(bound).filter(
        (command) => !deps.resolve(command),
      );
      if (unresolved.length === 0) return;
      const names = unresolved.map(describeCommand);
      throw new ConfigurationError(
        "CommandBus",
        `${names.length} bound command port(s) resolve to no registered pipeline: ${names.join(", ")}`,
        { unresolved: names, registered: deps.registered() },
      );
    },
  };
}
