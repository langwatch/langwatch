import type { z } from "zod";

import type { Command, CommandHandler } from "../commands/command.ts";
import type { CommandHandlerClassStatic } from "../commands/commandHandlerClass.ts";
import type { CommandSchema } from "../commands/commandSchema.ts";
import {
  type SchemaTypedCommandClass,
  type SealedCommand,
  sealCommand,
  sealCommandClass,
  type TenantScopedPayload,
} from "../commands/sealedCommand.ts";
import type { CommandType } from "../domain/commandType.ts";
import { type AggregateDefinition, aggregateWithEvents } from "../domain/definitions.ts";
import { indexEventSchemas, type PipelineEventSchema } from "../domain/eventSchemas.ts";
import type { Event, Projection } from "../domain/types.ts";
import type {
  CommandHandlerOptions,
  NoCommands,
  PipelineMetadata,
  RegisteredCommand,
  StaticPipelineDefinition,
} from "../index.ts";
import type {
  FoldProjectionDefinition,
  FoldProjectionOptions,
} from "../projections/foldProjection.types.ts";
import type {
  MapProjectionDefinition,
  MapProjectionOptions,
} from "../projections/mapProjection.types.ts";
import {
  type SealedFoldProjection,
  type SealedMapProjection,
  type SealedStateProjection,
  sealFoldProjection,
  sealMapProjection,
  sealStateProjection,
} from "../projections/sealedProjection.ts";
import type { StateProjectionDefinition } from "../projections/stateProjection.types.ts";
import { ConfigurationError } from "../services/errorHandling.ts";
import type { EventSubscriberDefinition } from "../subscribers/eventSubscriber.types.ts";
import type {
  SubscriberDispatchDefinition,
  SubscriberDispatchOptions,
} from "../subscribers/subscriber.types.ts";
import { buildProcessManager, type ProcessManagerApplier } from "./processBuilder.ts";
import type {
  ProcessManagerDefinition,
  SubscriberSpec,
  TriggerContext,
} from "./processManagerDefinition.ts";
import type { GlobalProjection } from "./staticBuilder.types.ts";

// Turns a union like {name:"a"; payload:A} | {name:"b"; payload:B}
// into a record { a: A; b: B }
export type CommandsUnionToRegistry<C extends RegisteredCommand> = {
  [K in C as K extends { name: infer N extends string } ? N : never]: K extends {
    payload: infer P;
  }
    ? P
    : never;
};

// Convenience: command name union from a StaticPipelineDefinition
export type CommandNamesFromPipeline<P extends StaticPipelineDefinition<any, any, any>> =
  keyof CommandsUnionToRegistry<P extends StaticPipelineDefinition<any, any, infer C> ? C : never>;

/** Builder for creating static pipeline definitions without runtime dependencies. */
export class PipelineBuilder<
  EventType extends Event = Event,
  RegisteredProjections extends Record<string, Projection> = Record<string, Projection>,
  RegisteredCommands extends RegisteredCommand = NoCommands,
  FoldNames extends string = never,
  MapNames extends string = never,
  RegisteredFoldStates extends Record<string, unknown> = Record<never, never>,
> {
  private foldProjections = new Map<
    string,
    SealedFoldProjection<EventType> & { options?: FoldProjectionOptions }
  >();
  private mapProjections = new Map<
    string,
    SealedMapProjection<EventType> & { options?: MapProjectionOptions }
  >();
  private stateProjections = new Map<string, SealedStateProjection<EventType>>();
  private commands: SealedCommand<EventType>[] = [];
  private foldSubscribers = new Map<
    string,
    {
      projectionName: string;
      definition: SubscriberDispatchDefinition<EventType>;
    }
  >();
  private mapSubscribers = new Map<
    string,
    {
      projectionName: string;
      definition: SubscriberDispatchDefinition<EventType>;
    }
  >();
  private processManagers = new Map<string, ProcessManagerDefinition>();
  private eventSubscribers = new Map<string, EventSubscriberDefinition<EventType>>();
  private prepareEventForProjection?: (event: EventType) => EventType;
  private readonly globalProjections: GlobalProjection[] = [];
  constructor(
    private readonly name: string,
    private readonly aggregate: AggregateDefinition,
    private readonly eventSchemas: ReadonlyMap<string, PipelineEventSchema>,
  ) {}

  /**
   * Installs the process-owned preparation seam used after durable storage and
   * before local projection or subscriber dispatch.
   */
  withProjectionPayloadPreparation(
    prepareEventForProjection: (event: EventType) => EventType,
  ): this {
    this.prepareEventForProjection = prepareEventForProjection;
    return this;
  }

  /**
   * A map projection over every pipeline's events, not only this one's, with the
   * subscribers that react to its records. The runtime registers it when this pipeline registers.
   */
  withGlobalMapProjection<MapRecord>(
    projection: MapProjectionDefinition<MapRecord, Event>,
    subscribers: readonly SubscriberDispatchDefinition<Event>[] = [],
  ): this {
    if (this.globalProjections.some(({ name }) => name === projection.name)) {
      this.throwDuplicateProjectionName(projection.name);
    }
    this.globalProjections.push({
      name: projection.name,
      register: (registry) => {
        registry.registerMapProjection(projection);
        for (const subscriber of subscribers) {
          registry.registerMapSubscriber(projection.name, subscriber);
        }
      },
    });
    return this;
  }

  /** Register a ClickHouse fold. The app must bind its store through the Redis
   * consistency adapter before constructing the definition. */
  withClickHouseFoldProjection<ProjectionName extends string, State>(
    definition: FoldProjectionDefinition<State, EventType> & {
      readonly name: ProjectionName;
    },
    options?: FoldProjectionOptions,
  ): PipelineBuilder<
    EventType,
    RegisteredProjections,
    RegisteredCommands,
    FoldNames | ProjectionName,
    MapNames,
    RegisteredFoldStates & Record<ProjectionName, State>
  > {
    return this.registerFoldProjection(definition.name, definition, options);
  }

  /** Register a ClickHouse replacing/map projection. */
  withClickHouseMapProjection<MapName extends string, MapRecord, Own extends Event>(
    definition: MapProjectionDefinition<MapRecord, Own> & {
      readonly name: MapName;
    },
    options?: MapProjectionOptions,
  ): PipelineBuilder<
    EventType,
    RegisteredProjections,
    RegisteredCommands,
    FoldNames,
    MapNames | MapName,
    RegisteredFoldStates
  > {
    return this.registerMapProjection(definition.name, definition, options);
  }

  /** Register a Postgres load/evolve/store projection. */
  withPostgresProjection<State>(definition: StateProjectionDefinition<State, EventType>): this {
    return this.registerStateProjection(definition);
  }

  /**
   * Register a fold projection (stateful, reduces events into accumulated state).
   *
   * @param name - Unique name for this projection within the pipeline
   * @param definition - Fold projection definition with init(), apply(), and store
   * @param options - Optional configuration for projection processing
   * @returns Builder instance for method chaining
   */
  private registerFoldProjection<ProjectionName extends string, State>(
    name: ProjectionName,
    definition: FoldProjectionDefinition<State, EventType>,
    options?: FoldProjectionOptions,
  ): PipelineBuilder<
    EventType,
    RegisteredProjections,
    RegisteredCommands,
    FoldNames | ProjectionName,
    MapNames,
    RegisteredFoldStates & Record<ProjectionName, State>
  > {
    if (this.foldProjections.has(name)) {
      throw new ConfigurationError(
        "PipelineBuilder",
        `Fold projection with name "${name}" already exists`,
        { projectionName: name },
      );
    }

    this.foldProjections.set(name, { ...sealFoldProjection(definition), options });

    return this;
  }

  /**
   * Register a map projection (stateless, transforms individual events into records).
   *
   * @param name - Unique name for this projection within the pipeline
   * @param definition - Map projection definition with map() and store
   * @param options - Optional configuration for projection processing
   * @returns Builder instance for method chaining
   */
  private registerMapProjection<MapName extends string, MapRecord, Own extends Event>(
    name: MapName,
    definition: MapProjectionDefinition<MapRecord, Own>,
    options?: MapProjectionOptions,
  ): PipelineBuilder<
    EventType,
    RegisteredProjections,
    RegisteredCommands,
    FoldNames,
    MapNames | MapName,
    RegisteredFoldStates
  > {
    if (this.mapProjections.has(name)) {
      throw new ConfigurationError(
        "PipelineBuilder",
        `Map projection with name "${name}" already exists`,
        { projectionName: name },
      );
    }

    this.mapProjections.set(name, {
      ...sealMapProjection<MapRecord, Own, EventType>(definition),
      options,
    });

    return this;
  }

  /**
   * Register the default operational state projection: one direct
   * repository load/apply/store cycle under the queue's per-key lock,
   * intentionally not a valid parent for `.withProjectionSubscriber()`.
   */
  private registerStateProjection<State>(
    definition: StateProjectionDefinition<State, EventType>,
  ): this {
    const name = definition.name;
    this.assertProjectionNameAvailable(name);
    this.stateProjections.set(name, sealStateProjection(definition));
    return this;
  }

  /** Register a live event consumer that receives no projection state. */
  withEventSubscriber(
    subscriberName: string,
    spec: SubscriberSpec<EventType> & { fold?: never; map?: never },
  ): this;
  withEventSubscriber(
    subscriberName: string,
    definition: EventSubscriberDefinition<EventType>,
  ): this;
  withEventSubscriber(
    subscriberName: string,
    definitionOrSpec:
      | EventSubscriberDefinition<EventType>
      | (SubscriberSpec<EventType> & { fold?: never; map?: never }),
  ): this {
    let definition: EventSubscriberDefinition<EventType>;
    if ("handler" in definitionOrSpec) {
      const spec = definitionOrSpec;
      const deduplication = spec.dedup;
      const dedupIdDeduplication = spec.dedupId
        ? {
            makeId: (event: EventType) => `subscriber:${subscriberName}:${spec.dedupId!(event)}`,
            ttlMs: spec.ttl,
          }
        : undefined;
      definition = {
        name: subscriberName,
        eventTypes: spec.events ?? [],
        options: {
          delay: spec.delay,
          groupKeyFn: spec.groupKeyFn,
          disabled: spec.disabled,
          deduplication:
            deduplication && deduplication !== "aggregate"
              ? {
                  ...deduplication,
                  makeId: (event) => deduplication.makeId(event),
                }
              : dedupIdDeduplication,
        },
        handle: async (event, context) => {
          const triggerContext = { ...context, state: undefined };
          if (spec.when && !spec.when(event, triggerContext)) {
            return;
          }
          await spec.handler(event, triggerContext);
        },
      };
    } else {
      definition = definitionOrSpec;
    }

    if (subscriberName !== definition.name) {
      throw new ConfigurationError(
        "PipelineBuilder",
        `Event subscriber name mismatch: arg "${subscriberName}" !== definition.name "${definition.name}"`,
        { subscriberName, definitionName: definition.name },
      );
    }
    this.assertSubscriberNameAvailable(subscriberName);
    this.eventSubscribers.set(subscriberName, definition);
    return this;
  }

  private assertSubscriberNameAvailable(subscriberName: string): void {
    if (this.eventSubscribers.has(subscriberName)) {
      this.throwDuplicateSubscriberName(subscriberName);
    }
    if (this.foldSubscribers.has(subscriberName)) {
      this.throwDuplicateSubscriberName(subscriberName);
    }
    if (this.mapSubscribers.has(subscriberName)) {
      this.throwDuplicateSubscriberName(subscriberName);
    }
  }

  private assertProjectionNameAvailable(name: string): void {
    if (this.stateProjections.has(name)) {
      this.throwDuplicateProjectionName(name);
    }
    if (this.foldProjections.has(name)) {
      this.throwDuplicateProjectionName(name);
    }
    if (this.mapProjections.has(name)) {
      this.throwDuplicateProjectionName(name);
    }
  }

  private throwDuplicateSubscriberName(subscriberName: string): never {
    throw new ConfigurationError(
      "PipelineBuilder",
      `Subscriber with name "${subscriberName}" already exists`,
      { subscriberName },
    );
  }

  private throwDuplicateProjectionName(name: string): never {
    throw new ConfigurationError(
      "PipelineBuilder",
      `Projection with name "${name}" already exists`,
      { projectionName: name },
    );
  }

  /** Register a subscriber receiving committed projection state, typed through its fold's name. */
  withProjectionSubscriber<Name extends FoldNames & keyof RegisteredFoldStates & string>(
    subscriberName: string,
    spec: SubscriberSpec<EventType, RegisteredFoldStates[Name]> & { fold: Name; map?: never },
  ): this;
  withProjectionSubscriber(
    subscriberName: string,
    spec: SubscriberSpec<EventType> & { map: MapNames & string; fold?: never },
  ): this;
  withProjectionSubscriber(
    subscriberName: string,
    // oxlint-disable-next-line typescript/no-explicit-any -- state crosses the fold-name lookup
    spec: SubscriberSpec<EventType, any> &
      ({ fold: FoldNames & string; map?: never } | { map: MapNames & string; fold?: never }),
  ): this {
    this.assertSubscriberNameAvailable(subscriberName);
    this.registerProjectionSubscriber(subscriberName, spec);
    return this;
  }

  /** Compile a projection subscriber and validate its parent projection. */
  private registerProjectionSubscriber(
    subscriberName: string,
    spec: SubscriberSpec<EventType>,
  ): void {
    const projectionName = (spec.fold ?? spec.map)!;
    const isFold = spec.fold !== undefined;
    if (isFold && !this.foldProjections.has(projectionName)) {
      throw new ConfigurationError(
        "PipelineBuilder",
        `Subscriber "${subscriberName}" fold "${projectionName}" — projection not found on this pipeline`,
        { subscriberName, projectionName },
      );
    }
    if (!isFold && !this.mapProjections.has(projectionName)) {
      throw new ConfigurationError(
        "PipelineBuilder",
        `Subscriber "${subscriberName}" map "${projectionName}" — projection not found on this pipeline`,
        { subscriberName, projectionName },
      );
    }

    const definition = buildProjectionSubscriberDefinition(subscriberName, spec);
    if (isFold) {
      this.foldSubscribers.set(subscriberName, { projectionName, definition });
    } else {
      this.mapSubscribers.set(subscriberName, { projectionName, definition });
    }
  }

  /** Mount a process manager (ADR-049/052) on this pipeline. */
  withProcessManager(name: string, applier: ProcessManagerApplier<EventType>): this;
  withProcessManager(definition: ProcessManagerDefinition<any, any, any>): this;
  withProcessManager(
    definitionOrName: ProcessManagerDefinition<any, any, any> | string,
    applier?: ProcessManagerApplier<EventType>,
  ): this {
    const definition =
      typeof definitionOrName === "string"
        ? buildProcessManager({ name: definitionOrName, applier: applier! })
        : definitionOrName;
    const name = definition.config.name;
    if (this.processManagers.has(name)) {
      throw new ConfigurationError(
        "PipelineBuilder",
        `Process manager "${name}" already declared on this pipeline`,
        { name },
      );
    }
    this.processManagers.set(name, definition);
    return this;
  }

  /** Register a command handler class with zero-arg constructor instantiation. */
  withCommand<Payload extends TenantScopedPayload, Type extends CommandType, Name extends string>(
    name: Name,
    handlerClass: SchemaTypedCommandClass<Payload, Type, EventType>,
    options?: CommandHandlerOptions<Payload>,
  ): PipelineBuilder<
    EventType,
    RegisteredProjections,
    RegisteredCommands | { name: Name; payload: Payload },
    FoldNames,
    MapNames,
    RegisteredFoldStates
  > {
    this.assertCommandNameFree(name);
    this.commands.push(sealCommandClass({ name, handlerClass, options }));
    return this;
  }

  /** Register a pre-constructed command handler instance with constructor DI. */
  withCommandInstance<
    Payload extends TenantScopedPayload,
    Type extends CommandType,
    Name extends string,
  >(
    name: Name,
    handlerClass: { readonly schema: CommandSchema<Payload, Type> } & CommandHandlerClassStatic<
      NoInfer<Payload>,
      NoInfer<Type>
    >,
    instance: CommandHandler<Command<NoInfer<Payload>>, EventType>,
    options?: CommandHandlerOptions<Payload>,
  ): PipelineBuilder<
    EventType,
    RegisteredProjections,
    RegisteredCommands | { name: Name; payload: Payload },
    FoldNames,
    MapNames,
    RegisteredFoldStates
  > {
    this.assertCommandNameFree(name);
    this.commands.push(
      sealCommand({
        name,
        handlerClassName: instance.constructor.name,
        handlerClass,
        createHandler: () => instance,
        options,
      }),
    );
    return this;
  }

  private assertCommandNameFree(name: string): void {
    if (this.commands.some((c) => c.definition.name === name)) {
      throw new ConfigurationError(
        "PipelineBuilder",
        `Command handler with name "${name}" already exists`,
        { commandHandlerName: name },
      );
    }
  }

  private declaredAggregate(): AggregateDefinition {
    return aggregateWithEvents({
      aggregate: this.aggregate,
      eventTypes: [...this.eventSchemas.keys()],
    });
  }

  /** Build the static pipeline definition. */
  build(): StaticPipelineDefinition<EventType, RegisteredProjections, RegisteredCommands> {
    const aggregate = this.declaredAggregate();
    // Build metadata for tooling and introspection
    const metadata: PipelineMetadata = {
      name: this.name,
      aggregateType: aggregate.type,
      allowedEventTypes: aggregate.events.map((event) => event.type),
      projections: Array.from(this.foldProjections.entries()).map(([name, def]) => ({
        name,
        handlerClassName: `FoldProjection(${def.definition.name})`,
      })),
      mapProjections: Array.from(this.mapProjections.entries()).map(([name, def]) => ({
        name,
        handlerClassName: `MapProjection(${def.definition.name})`,
        eventTypes: def.definition.eventTypes as string[],
      })),
      stateProjections: Array.from(this.stateProjections.entries()).map(
        ([name, { definition }]) => ({
          name,
          handlerClassName: `Projection(${definition.name})`,
          eventTypes: [...definition.eventTypes],
        }),
      ),
      subscribers: Array.from(this.eventSubscribers.values()).map((subscriber) => ({
        name: subscriber.name,
        eventTypes: [...subscriber.eventTypes],
      })),
      commands: this.commands.map(({ definition }) => ({
        name: definition.name,
        handlerClassName: definition.handlerClassName,
      })),
    };

    return {
      aggregate,
      eventSchemas: this.eventSchemas,
      metadata,
      prepareEventForProjection: this.prepareEventForProjection,
      foldProjections: this.foldProjections,
      stateProjections: this.stateProjections,
      mapProjections: this.mapProjections,
      commands: this.commands,
      foldSubscribers: this.foldSubscribers,
      mapSubscribers: this.mapSubscribers,
      eventSubscribers: this.eventSubscribers,
      processManagers: this.processManagers,
      globalProjections: [...this.globalProjections],
      // Purely for typing: lets downstream code infer the command names + payloads
      // from `.withCommand(...)` calls without any runtime cost.
      commandRegistry: {} as CommandsUnionToRegistry<RegisteredCommands>,
    } as StaticPipelineDefinition<EventType, RegisteredProjections, RegisteredCommands> & {
      commandRegistry: CommandsUnionToRegistry<RegisteredCommands>;
    };
  }
}

/** The events a pipeline's `.withEvents` schemas declare (§9); none keeps the open `Event`. */
export type DeclaredEvents<Schemas extends readonly PipelineEventSchema[]> = [
  Schemas[number],
] extends [never]
  ? Event
  : z.output<Schemas[number]>;

/** A named pipeline before its events: `.withEvents(schemas)`, its only call, fixes the type. */
export class PipelineDeclaration {
  constructor(
    private readonly name: string,
    private readonly aggregate: AggregateDefinition,
  ) {}

  withEvents<const Schemas extends readonly PipelineEventSchema[]>(
    schemas: Schemas,
  ): PipelineBuilder<
    DeclaredEvents<Schemas>,
    Record<string, Projection>,
    NoCommands,
    never,
    never,
    Record<never, never>
  > {
    return new PipelineBuilder(
      this.name,
      this.aggregate,
      indexEventSchemas({ pipelineName: this.name, schemas }),
    );
  }
}

/** Starts a pipeline; its event type comes from the `.withEvents` call that must follow. */
export function definePipeline(config: {
  name: string;
  aggregate: AggregateDefinition;
}): PipelineDeclaration {
  return new PipelineDeclaration(config.name, config.aggregate);
}

type SubscriberJobPayload = { event: Event; foldState: unknown };

function toTriggerContext(subscriberDispatchContext: {
  tenantId: string;
  aggregateId: string;
  foldState: unknown;
}): TriggerContext<unknown> {
  return {
    tenantId: subscriberDispatchContext.tenantId,
    aggregateId: subscriberDispatchContext.aggregateId,
    state: subscriberDispatchContext.foldState,
  };
}

/**
 * Dedup only when the spec asks for it (dedup / dedupId / ttl); otherwise
 * EVERY event must dispatch its own job — e.g. a lifecycle sync where a
 * coalesced batch carrying both `started` and `finished` must deliver both.
 */
function buildProjectionSubscriberDedup<E extends Event>(
  subscriberName: string,
  spec: SubscriberSpec<E>,
): (SubscriberDispatchOptions["deduplication"] & object) | undefined {
  const wantsDedup =
    spec.dedup !== undefined || spec.dedupId !== undefined || spec.ttl !== undefined;
  if (!wantsDedup) return undefined;

  const customDedup = spec.dedup && spec.dedup !== "aggregate" ? spec.dedup : undefined;
  if (customDedup) {
    return {
      ...customDedup,
      makeId: (payload: SubscriberJobPayload) =>
        `subscriber:${subscriberName}:${customDedup.makeId(payload.event as E, payload.foldState)}`,
      ttlMs: spec.ttl ?? customDedup.ttlMs,
    };
  }

  const defaultId = (event: Event) => `${event.tenantId}:${String(event.aggregateId)}`;
  return {
    makeId: (payload: SubscriberJobPayload) =>
      `subscriber:${subscriberName}:${
        spec.dedupId ? spec.dedupId(payload.event as E) : defaultId(payload.event)
      }`,
    ttlMs: spec.ttl ?? 30_000,
  };
}

function buildProjectionSubscriberDefinition<E extends Event>(
  subscriberName: string,
  spec: SubscriberSpec<E>,
): SubscriberDispatchDefinition<E> {
  const eventFilter = spec.events !== undefined ? new Set<string>(spec.events) : null;
  const passes = (event: E, context: TriggerContext<unknown>): boolean => {
    if (eventFilter && !eventFilter.has(event.type)) return false;
    return spec.when?.(event, context) ?? true;
  };

  const deduplication = buildProjectionSubscriberDedup(subscriberName, spec);

  return {
    name: subscriberName,
    options: {
      deduplication,
      // The router's pre-staging batch collapse reads `makeJobId`, the
      // queue reads `deduplication.makeId`; one function serves both so
      // they cannot drift (same doctrine as `throttledPerWindow`).
      makeJobId: deduplication?.makeId,
      runIn: spec.runIn,
      disabled: spec.disabled,
      delay: spec.delay ?? 0,
      // Subscriber payloads wrap the event; adapt the spec's event-shaped
      // key so fold/map subscribers get the same lane semantics as raw
      // ones instead of a silently dropped option.
      groupKeyFn: spec.groupKeyFn
        ? (payload: SubscriberJobPayload) => spec.groupKeyFn!(payload.event as E, payload.foldState)
        : undefined,
    },
    // Pre-enqueue rejection: a filtered event never pays serialization.
    // The committed projection state is in hand at guard time, so
    // state-dependent `when` guards reject before enqueue too.
    shouldDispatch: (event, context) => passes(event, toTriggerContext(context)),
    handle: async (event, context) => {
      const triggerContext = toTriggerContext(context);
      if (!passes(event, triggerContext)) return;
      await spec.handler(event, triggerContext);
    },
  };
}
