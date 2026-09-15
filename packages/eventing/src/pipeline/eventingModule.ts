/**
 * A module's event sourcing, as one declaration (ADR-144). `definePipeline`
 * already states the aggregate, events, projections, subscribers, process
 * managers and commands; this adds only the seam into a module. It is what
 * `server/src/eventing/<m>.pipeline.ts` exports and `.withEventing(...)` takes.
 */
import type { FeatureEventing, FeatureEventingSetup } from "@langwatch/runtime-composition";
import type { ProcessStore } from "../process-manager/stores/processStore.types.ts";
import type { EventSourcedQueueProcessor } from "./../queues/queue.types.ts";
import { ConfigurationError } from "../services/errorHandling.ts";
import type {
  NoCommands,
  RegisteredCommand,
  StaticPipelineDefinition,
} from "./staticBuilder.types.ts";

/**
 * What a declaration is handed when a process installs it. `repositories` and
 * `app` are the module's own, the same instances the app was constructed with
 * rather than a second graph over the same rows.
 */
export type EventingSetup<Repositories, App> = FeatureEventingSetup<
  Repositories,
  App,
  ProcessStore
>;

/** One command's sender, as a registered pipeline answers with it. */
export type EventingCommandSender<Payload> = EventSourcedQueueProcessor<
  Payload & Record<string, unknown>
>;

/**
 * The senders a registered pipeline answers with, keyed by command name and
 * typed from the definition `build` returned. A pipeline registering no
 * command answers an empty record rather than a name a caller can misspell.
 */
export type EventingCommands<Definition> =
  Definition extends StaticPipelineDefinition<any, any, infer Commands extends RegisteredCommand>
    ? [Commands] extends [NoCommands]
      ? Readonly<Record<never, never>>
      : Readonly<{ [Name in Commands as Name["name"]]: EventingCommandSender<Name["payload"]> }>
    : never;

/** What a module does with its own pipeline's senders, once it has them. */
export interface EventingConnection<App, Definition> {
  readonly app: App;
  readonly commands: EventingCommands<Definition>;
}

/** A module's event sourcing, declared once. */
export interface EventingModule<Repositories, App, Definition> extends FeatureEventing<
  Repositories,
  App,
  ProcessStore,
  Definition
> {
  readonly pipeline: string;
  build(setup: EventingSetup<Repositories, App>): Definition;
  connect?(bound: EventingConnection<App, Definition>): void;
}

/**
 * Names one module's event sourcing. `Repositories` and `App` are read off the
 * annotated `build` parameter and the pipeline's types off its return, so
 * `connect` is typed in the command names the pipeline registered and a
 * declaration written for another module's app fails to compile where
 * `.withEventing` takes it. See `modules/api-key/server/src/eventing`.
 */
export function defineEventingModule<
  Repositories,
  App,
  const Definition extends StaticPipelineDefinition<any, any, any>,
>(
  declaration: EventingModule<Repositories, App, Definition>,
): EventingModule<Repositories, App, Definition> {
  const pipeline = declaration.pipeline.trim();
  if (!pipeline) {
    throw new ConfigurationError(
      "eventing-module",
      "An eventing module names the pipeline it installs.",
    );
  }
  const connect = declaration.connect?.bind(declaration);
  return {
    pipeline,
    build: (setup) => declaration.build(setup),
    // The one cast in the seam: composition reads registration back with the
    // pipeline's types erased, and the definition `build` answered is what
    // says which senders exist.
    ...(connect
      ? {
          connect: (bound: Readonly<{ app: App; commands: Readonly<Record<string, unknown>> }>) =>
            connect({
              app: bound.app,
              commands: bound.commands as EventingCommands<Definition>,
            }),
        }
      : {}),
  };
}
