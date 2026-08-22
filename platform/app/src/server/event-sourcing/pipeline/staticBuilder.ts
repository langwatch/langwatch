import type { FeatureFlagServiceInterface } from "../../featureFlag/types";
import type {
  CommandHandlerOptions,
  NoCommands,
  PipelineMetadata,
  RegisteredCommand,
  StaticPipelineDefinition,
} from "..";
import type { CommandHandler } from "../commands/command";
import type {
  CommandHandlerClass,
  CommandHandlerClassStatic,
  ExtractCommandHandlerPayload,
} from "../commands/commandHandlerClass";
import {
  type AggregateScope,
  type AggregateScopeDeclaration,
  AggregateScopeError,
  commandAggregateType,
  declaredAggregateScope,
  isMultiAggregate,
  primaryAggregateType,
  singleAggregateScope,
} from "../domain/aggregateScope";
import type { AggregateType } from "../domain/aggregateType";
import type { Event, Projection } from "../domain/types";
import type {
  FoldProjectionDefinition,
  FoldProjectionOptions,
} from "../projections/foldProjection.types";
import type {
  MapProjectionDefinition,
  MapProjectionOptions,
} from "../projections/mapProjection.types";
import type { StateProjectionDefinition } from "../projections/stateProjection.types";
import { ConfigurationError } from "../services/errorHandling";
import type { EventSubscriberDefinition } from "../subscribers/eventSubscriber.types";
import type {
  SubscriberDispatchDefinition,
  SubscriberDispatchOptions,
} from "../subscribers/subscriber.types";
import {
  buildProcessManager,
  type ProcessManagerApplier,
} from "./processBuilder";
import type {
  ProcessManagerDefinition,
  SubscriberSpec,
  TriggerContext,
} from "./processManagerDefinition";

// Turns a union like {name:"a"; payload:A} | {name:"b"; payload:B}
// into a record { a: A; b: B }
export type CommandsUnionToRegistry<C extends RegisteredCommand> = {
  [K in C as K extends { name: infer N extends string }
    ? N
    : never]: K extends { payload: infer P } ? P : never;
};

// Convenience: command name union from a StaticPipelineDefinition
export type CommandNamesFromPipeline<
  P extends StaticPipelineDefinition<any, any, any>,
> = keyof CommandsUnionToRegistry<
  P extends StaticPipelineDefinition<any, any, infer C> ? C : never
>;

/**
 * Builder for creating static pipeline definitions without runtime dependencies.
 * Use `definePipeline()` to start building a pipeline.
 *
 * @example
 * ```typescript
 * const pipeline = definePipeline<MyEvent>()
 *   .withName("my-pipeline")
 *   .withAggregateType("entity")
 *   .withFoldProjection("summary", summaryProjection)
 *   .withMapProjection("spanStorage", spanStorageProjection)
 *   .build();
 * ```
 */
export class StaticPipelineBuilder<EventType extends Event> {
  withName(name: string): StaticPipelineBuilderWithName<EventType> {
    return new StaticPipelineBuilderWithName(name);
  }

  build(): never {
    throw new ConfigurationError(
      "StaticPipelineBuilder",
      "Pipeline name is required",
    );
  }
}

export class StaticPipelineBuilderWithName<EventType extends Event = Event> {
  constructor(private readonly name: string) {}

  withAggregateType(
    aggregateType: AggregateType,
  ): StaticPipelineBuilderWithNameAndType<
    EventType,
    Record<string, Projection>,
    NoCommands,
    never,
    never,
    Record<never, never>
  > {
    return new StaticPipelineBuilderWithNameAndType(
      this.name,
      singleAggregateScope(aggregateType),
    );
  }

  /**
   * Declare the set of aggregate types this pipeline owns, each with the
   * event types it owns (ADR-113). With one entry this is `withAggregateType`
   * plus event ownership validation at append; with several, commands must
   * name the aggregate they write, fold state is keyed by type and id, and
   * projection kill-switches use the pipeline name.
   */
  withAggregateTypes(
    declaration: AggregateScopeDeclaration,
  ): StaticPipelineBuilderWithNameAndType<
    EventType,
    Record<string, Projection>,
    NoCommands,
    never,
    never,
    Record<never, never>
  > {
    try {
      return new StaticPipelineBuilderWithNameAndType(
        this.name,
        declaredAggregateScope(declaration),
      );
    } catch (error) {
      if (error instanceof AggregateScopeError) {
        throw new ConfigurationError("StaticPipelineBuilder", error.message, {
          pipelineName: this.name,
          ...error.details,
        });
      }
      throw error;
    }
  }

  build(): never {
    throw new ConfigurationError(
      "StaticPipelineBuilder",
      "Aggregate type is required",
    );
  }
}

export class StaticPipelineBuilderWithNameAndType<
  EventType extends Event = Event,
  RegisteredProjections extends Record<string, Projection> = Record<
    string,
    Projection
  >,
  RegisteredCommands extends RegisteredCommand = NoCommands,
  FoldNames extends string = never,
  MapNames extends string = never,
  RegisteredFoldStates extends Record<string, unknown> = Record<never, never>,
> {
  private foldProjections = new Map<
    string,
    {
      definition: FoldProjectionDefinition<any, EventType>;
      options?: FoldProjectionOptions;
    }
  >();
  private mapProjections = new Map<
    string,
    {
      definition: MapProjectionDefinition<any, EventType>;
      options?: MapProjectionOptions;
    }
  >();
  private stateProjections = new Map<
    string,
    StateProjectionDefinition<any, EventType>
  >();
  private commands: Array<{
    name: string;
    handlerClass: CommandHandlerClass<any, any, any>;
    handlerInstance?: any;
    options?: CommandHandlerOptions;
  }> = [];
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
  private eventSubscribers = new Map<
    string,
    EventSubscriberDefinition<EventType>
  >();
  private featureFlagService?: FeatureFlagServiceInterface;

  constructor(
    private readonly name: string,
    private readonly aggregateScope: AggregateScope,
  ) {}

  private get aggregateType(): AggregateType {
    return primaryAggregateType(this.aggregateScope);
  }

  /**
   * Every command on a multi-aggregate pipeline names its aggregate, and it is
   * one the pipeline declares. Checked at registration so the failure names
   * the command, not a queue key at dispatch.
   */
  private assertCommandAggregate(
    name: string,
    options: CommandHandlerOptions | undefined,
  ): void {
    try {
      commandAggregateType({
        scope: this.aggregateScope,
        commandName: name,
        declared: options?.aggregateType,
      });
    } catch (error) {
      if (error instanceof AggregateScopeError) {
        throw new ConfigurationError("StaticPipelineBuilder", error.message, {
          pipelineName: this.name,
          commandHandlerName: name,
          ...error.details,
        });
      }
      throw error;
    }
  }

  /**
   * A fold with its own event loader on a multi-aggregate pipeline would read
   * one aggregate's history for every type unless the loader is type-aware;
   * the auto-wired loaders are, a custom one must say so.
   */
  private assertFoldLoaderIsTypeAware(
    name: string,
    definition: FoldProjectionDefinition<any, EventType>,
  ): void {
    if (!isMultiAggregate(this.aggregateScope)) return;
    if (definition.eventLoader && !definition.eventLoaderIsAggregateTypeAware) {
      throw new ConfigurationError(
        "StaticPipelineBuilder",
        `Fold projection "${name}" registers a custom eventLoader on a pipeline that declares ${this.aggregateScope.types.join(", ")}; the loader must read ctx.aggregateType and set eventLoaderIsAggregateTypeAware, or it conflates the aggregates' histories`,
        {
          pipelineName: this.name,
          projectionName: name,
          aggregateTypes: this.aggregateScope.types,
        },
      );
    }
  }

  /**
   * Register a fold projection (stateful, reduces events into accumulated state).
   *
   * @param name - Unique name for this projection within the pipeline
   * @param definition - Fold projection definition with init(), apply(), and store
   * @param options - Optional configuration for projection processing
   * @returns Builder instance for method chaining
   */
  withFoldProjection<ProjectionName extends string, State>(
    name: ProjectionName,
    definition: FoldProjectionDefinition<State, EventType>,
    options?: FoldProjectionOptions,
  ): StaticPipelineBuilderWithNameAndType<
    EventType,
    RegisteredProjections,
    RegisteredCommands,
    FoldNames | ProjectionName,
    MapNames,
    RegisteredFoldStates & Record<ProjectionName, State>
  > {
    if (this.foldProjections.has(name)) {
      throw new ConfigurationError(
        "StaticPipelineBuilder",
        `Fold projection with name "${name}" already exists`,
        { projectionName: name },
      );
    }

    this.assertFoldLoaderIsTypeAware(name, definition);
    this.foldProjections.set(name, { definition, options });

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
  withMapProjection<MapName extends string>(
    name: MapName,
    definition: MapProjectionDefinition<any, EventType>,
    options?: MapProjectionOptions,
  ): StaticPipelineBuilderWithNameAndType<
    EventType,
    RegisteredProjections,
    RegisteredCommands,
    FoldNames,
    MapNames | MapName,
    RegisteredFoldStates
  > {
    if (this.mapProjections.has(name)) {
      throw new ConfigurationError(
        "StaticPipelineBuilder",
        `Map projection with name "${name}" already exists`,
        { projectionName: name },
      );
    }

    this.mapProjections.set(name, { definition, options });

    return this;
  }

  /**
   * Register the default operational state projection.
   *
   * It runs as one direct repository load/apply/store cycle under the queue's
   * per-key lock. It is intentionally not a valid parent for
   * `.withSubscriber()`.
   */
  withProjection(
    name: string,
    definition: StateProjectionDefinition<any, EventType>,
  ): this {
    if (name !== definition.name) {
      throw new ConfigurationError(
        "StaticPipelineBuilder",
        `Projection name mismatch: arg "${name}" !== definition.name "${definition.name}"`,
        { projectionName: name, definitionName: definition.name },
      );
    }
    if (
      this.stateProjections.has(name) ||
      this.foldProjections.has(name) ||
      this.mapProjections.has(name)
    ) {
      throw new ConfigurationError(
        "StaticPipelineBuilder",
        `Projection with name "${name}" already exists`,
        { projectionName: name },
      );
    }
    this.stateProjections.set(name, definition);
    return this;
  }

  /**
   * Register a feature flag service for kill switches.
   * When provided, enables automatic feature flag-based kill switches for all components.
   *
   * @param featureFlagService - Feature flag service implementation
   * @returns Builder instance for method chaining
   */
  withFeatureFlagService(
    featureFlagService: FeatureFlagServiceInterface,
  ): this {
    this.featureFlagService = featureFlagService;
    return this;
  }

  /** Register a live event consumer that receives no projection state. */
  withEventSubscriber(
    subscriberName: string,
    definition: EventSubscriberDefinition<EventType>,
  ): this {
    if (subscriberName !== definition.name) {
      throw new ConfigurationError(
        "StaticPipelineBuilder",
        `Event subscriber name mismatch: arg "${subscriberName}" !== definition.name "${definition.name}"`,
        { subscriberName, definitionName: definition.name },
      );
    }
    if (this.eventSubscribers.has(subscriberName)) {
      throw new ConfigurationError(
        "StaticPipelineBuilder",
        `Event subscriber with name "${subscriberName}" already exists`,
        { subscriberName },
      );
    }
    this.eventSubscribers.set(subscriberName, definition);
    return this;
  }

  /**
   * The best-effort reaction primitive (ADR-052). One trigger descriptor:
   * `fold`/`map` stages the handler after that projection commits the event
   * (with the committed state in `ctx.state`); `events` fires on raw
   * delivery and doubles as a filter when combined with `fold`/`map`.
   * Retry is queue redelivery — use only where losing one is harmless.
   */
  withSubscriber<Fold extends FoldNames & keyof RegisteredFoldStates & string>(
    subscriberName: string,
    spec: SubscriberSpec<EventType> & {
      fold: Fold;
      when?: (
        event: EventType,
        context: TriggerContext<RegisteredFoldStates[Fold]>,
      ) => boolean;
      handler: (
        event: EventType,
        context: TriggerContext<RegisteredFoldStates[Fold]>,
      ) => Promise<void>;
    },
  ): this;
  withSubscriber(subscriberName: string, spec: SubscriberSpec<EventType>): this;
  withSubscriber(
    subscriberName: string,
    spec: SubscriberSpec<EventType>,
  ): this {
    const nameTaken =
      this.eventSubscribers.has(subscriberName) ||
      this.foldSubscribers.has(subscriberName) ||
      this.mapSubscribers.has(subscriberName);
    if (nameTaken) {
      throw new ConfigurationError(
        "StaticPipelineBuilder",
        `Subscriber with name "${subscriberName}" already exists`,
        { subscriberName },
      );
    }

    if (spec.fold !== undefined || spec.map !== undefined) {
      this.registerProjectionSubscriber(subscriberName, spec);
      return this;
    }

    this.eventSubscribers.set(subscriberName, {
      name: subscriberName,
      eventTypes: spec.events ?? [],
      options: {
        delay: spec.delay,
        groupKeyFn: spec.groupKeyFn,
        deduplication:
          spec.dedup ??
          (spec.dedupId
            ? {
                makeId: (event) =>
                  `subscriber:${subscriberName}:${spec.dedupId!(event)}`,
                ttlMs: spec.ttl,
              }
            : undefined),
      },
      handle: async (event, context) => {
        const triggerContext = {
          tenantId: context.tenantId,
          aggregateId: context.aggregateId,
          state: undefined,
        };
        if (spec.when && !spec.when(event, triggerContext)) return;
        await spec.handler(event, triggerContext);
      },
    });
    return this;
  }

  /** The fold/map half of `withSubscriber`: compiles the spec into the shared
   *  post-projection registration and validates its parent projection. */
  private registerProjectionSubscriber(
    subscriberName: string,
    spec: SubscriberSpec<EventType>,
  ): void {
    const projectionName = (spec.fold ?? spec.map)!;
    const isFold = spec.fold !== undefined;
    if (isFold && !this.foldProjections.has(projectionName)) {
      throw new ConfigurationError(
        "StaticPipelineBuilder",
        `Subscriber "${subscriberName}" fold "${projectionName}" — projection not found on this pipeline`,
        { subscriberName, projectionName },
      );
    }
    if (!isFold && !this.mapProjections.has(projectionName)) {
      throw new ConfigurationError(
        "StaticPipelineBuilder",
        `Subscriber "${subscriberName}" map "${projectionName}" — projection not found on this pipeline`,
        { subscriberName, projectionName },
      );
    }

    const definition = buildProjectionSubscriberDefinition(
      subscriberName,
      spec,
    );
    if (isFold) {
      this.foldSubscribers.set(subscriberName, { projectionName, definition });
    } else {
      this.mapSubscribers.set(subscriberName, { projectionName, definition });
    }
  }

  /**
   * Mount a process manager (ADR-049/052) on this pipeline — the promised
   * reaction primitive. Author it with the staged callback builder:
   *
   *   .withProcessManager("triggerSettlement", triggerSettlementPM(deps))
   *
   * where the domain exports `(deps) => (pm) => pm.state(…).intent(…)…`.
   * The runtime owns its manager, the shared process-outbox and wake
   * workers, and the trigger adapters generated from its triggers.
   */
  withProcessManager(
    name: string,
    applier: ProcessManagerApplier<EventType>,
  ): this;
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
        "StaticPipelineBuilder",
        `Process manager "${name}" already declared on this pipeline`,
        { name },
      );
    }
    this.processManagers.set(name, definition);
    return this;
  }

  /**
   * Register a command handler class (zero-arg constructor).
   * The framework will instantiate the handler via `new handlerClass()`.
   *
   * @param name - Unique name for this command handler within the pipeline
   * @param handlerClass - The command handler class to register
   * @param options - Optional configuration
   * @returns Builder instance for method chaining
   */
  withCommand<
    handlerClass extends CommandHandlerClass<any, any, any>,
    Name extends string,
  >(
    name: Name,
    handlerClass: handlerClass,
    options?: CommandHandlerOptions,
  ): StaticPipelineBuilderWithNameAndType<
    EventType,
    RegisteredProjections,
    | RegisteredCommands
    | { name: Name; payload: ExtractCommandHandlerPayload<handlerClass> },
    FoldNames,
    MapNames,
    RegisteredFoldStates
  > {
    if (this.commands.some((c) => c.name === name)) {
      throw new ConfigurationError(
        "StaticPipelineBuilder",
        `Command handler with name "${name}" already exists`,
        { commandHandlerName: name },
      );
    }

    this.assertCommandAggregate(name, options);
    this.commands.push({ name, handlerClass: handlerClass, options });
    return this as StaticPipelineBuilderWithNameAndType<
      EventType,
      RegisteredProjections,
      | RegisteredCommands
      | { name: Name; payload: ExtractCommandHandlerPayload<handlerClass> },
      FoldNames,
      MapNames,
      RegisteredFoldStates
    >;
  }

  /**
   * Register a pre-constructed command handler instance.
   * Use this for complex commands that require constructor DI (dependencies injected
   * at construction time). The class is still needed for its static properties
   * (schema, getAggregateId, etc.), but the instance is used instead of `new handlerClass()`.
   *
   * @param name - Unique name for this command handler within the pipeline
   * @param handlerClass - The command handler class (provides static properties)
   * @param instance - Pre-constructed handler instance
   * @param options - Optional configuration
   * @returns Builder instance for method chaining
   */
  withCommandInstance<
    TStatic extends CommandHandlerClassStatic<any, any>,
    Name extends string,
  >(
    name: Name,
    handlerClass: TStatic,
    instance: CommandHandler<any, any>,
    options?: CommandHandlerOptions,
  ): StaticPipelineBuilderWithNameAndType<
    EventType,
    RegisteredProjections,
    | RegisteredCommands
    | { name: Name; payload: ExtractCommandHandlerPayload<TStatic> },
    FoldNames,
    MapNames,
    RegisteredFoldStates
  > {
    if (this.commands.some((c) => c.name === name)) {
      throw new ConfigurationError(
        "StaticPipelineBuilder",
        `Command handler with name "${name}" already exists`,
        { commandHandlerName: name },
      );
    }

    this.assertCommandAggregate(name, options);
    // Cast TStatic to CommandHandlerClass for storage — the static properties match,
    // and the zero-arg constructor won't be called since handlerInstance is provided.
    this.commands.push({
      name,
      handlerClass: handlerClass as unknown as CommandHandlerClass<
        any,
        any,
        any
      >,
      handlerInstance: instance,
      options,
    });
    return this as StaticPipelineBuilderWithNameAndType<
      EventType,
      RegisteredProjections,
      | RegisteredCommands
      | { name: Name; payload: ExtractCommandHandlerPayload<TStatic> },
      FoldNames,
      MapNames,
      RegisteredFoldStates
    >;
  }

  /**
   * Build the static pipeline definition.
   * This creates metadata and stores projection definitions but does not connect to runtime infrastructure.
   *
   * @returns Static pipeline definition that can be registered at runtime
   */
  build(): StaticPipelineDefinition<
    EventType,
    RegisteredProjections,
    RegisteredCommands
  > {
    // Build metadata for tooling and introspection
    const metadata: PipelineMetadata = {
      name: this.name,
      aggregateType: this.aggregateType,
      aggregateScope: this.aggregateScope,
      projections: Array.from(this.foldProjections.entries()).map(
        ([name, def]) => ({
          name,
          handlerClassName: `FoldProjection(${def.definition.name})`,
        }),
      ),
      mapProjections: Array.from(this.mapProjections.entries()).map(
        ([name, def]) => ({
          name,
          handlerClassName: `MapProjection(${def.definition.name})`,
          eventTypes: def.definition.eventTypes as string[],
        }),
      ),
      stateProjections: Array.from(this.stateProjections.entries()).map(
        ([name, definition]) => ({
          name,
          handlerClassName: `Projection(${definition.name})`,
          eventTypes: [...definition.eventTypes],
        }),
      ),
      subscribers: Array.from(this.eventSubscribers.values()).map(
        (subscriber) => ({
          name: subscriber.name,
          eventTypes: [...subscriber.eventTypes],
        }),
      ),
      commands: this.commands.map((cmd) => ({
        name: cmd.name,
        handlerClassName: cmd.handlerClass.name,
      })),
    };

    return {
      metadata,
      foldProjections: this.foldProjections,
      stateProjections: this.stateProjections,
      mapProjections: this.mapProjections,
      commands: this.commands,
      foldSubscribers: this.foldSubscribers,
      mapSubscribers: this.mapSubscribers,
      eventSubscribers: this.eventSubscribers,
      processManagers: this.processManagers,
      featureFlagService: this.featureFlagService,

      // Purely for typing: lets downstream code infer the command names + payloads
      // from `.withCommand(...)` calls without any runtime cost.
      commandRegistry: {} as CommandsUnionToRegistry<RegisteredCommands>,
    } as StaticPipelineDefinition<
      EventType,
      RegisteredProjections,
      RegisteredCommands
    > & {
      commandRegistry: CommandsUnionToRegistry<RegisteredCommands>;
    };
  }
}

/**
 * Creates a new static pipeline builder.
 * Use this to define pipelines without triggering runtime initialization.
 *
 * @example
 * ```typescript
 * export const myPipeline = definePipeline<MyEvent>()
 *   .withName("my-pipeline")
 *   .withAggregateType("entity")
 *   .withFoldProjection("summary", summaryProjection)
 *   .withMapProjection("spanStorage", spanStorageProjection)
 *   .build();
 * ```
 */
export function definePipeline<
  EventType extends Event,
>(): StaticPipelineBuilder<EventType> {
  return new StaticPipelineBuilder<EventType>();
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
 * Dedup only when the spec asks for it (dedup / dedupId / ttl). A spec
 * without any of those means EVERY event must dispatch its own job —
 * e.g. a lifecycle sync where a coalesced batch carrying both `started`
 * and `finished` must deliver both, not collapse to the newest.
 */
function buildProjectionSubscriberDedup<E extends Event>(
  subscriberName: string,
  spec: SubscriberSpec<E>,
): (SubscriberDispatchOptions["deduplication"] & object) | undefined {
  const wantsDedup =
    spec.dedup !== undefined ||
    spec.dedupId !== undefined ||
    spec.ttl !== undefined;
  if (!wantsDedup) return undefined;

  const customDedup =
    spec.dedup && spec.dedup !== "aggregate" ? spec.dedup : undefined;
  if (customDedup) {
    return {
      ...customDedup,
      makeId: (payload: SubscriberJobPayload) =>
        `subscriber:${subscriberName}:${customDedup.makeId(payload.event as E, payload.foldState)}`,
      ttlMs: spec.ttl ?? customDedup.ttlMs,
    };
  }

  const defaultId = (event: Event) =>
    `${event.tenantId}:${String(event.aggregateId)}`;
  return {
    makeId: (payload: SubscriberJobPayload) =>
      `subscriber:${subscriberName}:${
        spec.dedupId
          ? spec.dedupId(payload.event as E)
          : defaultId(payload.event)
      }`,
    ttlMs: spec.ttl ?? 30_000,
  };
}

function buildProjectionSubscriberDefinition<E extends Event>(
  subscriberName: string,
  spec: SubscriberSpec<E>,
): SubscriberDispatchDefinition<E> {
  const eventFilter =
    spec.events !== undefined ? new Set<string>(spec.events) : null;
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
        ? (payload: SubscriberJobPayload) =>
            spec.groupKeyFn!(payload.event as E, payload.foldState)
        : undefined,
    },
    // Pre-enqueue rejection: a filtered event never pays serialization.
    // The committed projection state is in hand at guard time, so
    // state-dependent `when` guards reject before enqueue too.
    shouldDispatch: (event, context) =>
      passes(event, toTriggerContext(context)),
    handle: async (event, context) => {
      const triggerContext = toTriggerContext(context);
      if (!passes(event, triggerContext)) return;
      await spec.handler(event, triggerContext);
    },
  };
}
