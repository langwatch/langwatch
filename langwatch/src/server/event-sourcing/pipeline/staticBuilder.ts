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
import type { ReactorDefinition } from "../reactors/reactor.types";
import type { EventSubscriberDefinition } from "../subscribers/eventSubscriber.types";
import { ConfigurationError } from "../services/errorHandling";
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
    never
  > {
    return new StaticPipelineBuilderWithNameAndType(this.name, aggregateType);
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
  private foldReactors = new Map<
    string,
    { projectionName: string; definition: ReactorDefinition<EventType> }
  >();
  private mapReactors = new Map<
    string,
    { projectionName: string; definition: ReactorDefinition<EventType> }
  >();
  private processManagers = new Map<string, ProcessManagerDefinition>();
  private eventSubscribers = new Map<
    string,
    EventSubscriberDefinition<EventType>
  >();
  private featureFlagService?: FeatureFlagServiceInterface;

  constructor(
    private readonly name: string,
    private readonly aggregateType: AggregateType,
  ) {}

  /**
   * Register a fold projection (stateful, reduces events into accumulated state).
   *
   * @param name - Unique name for this projection within the pipeline
   * @param definition - Fold projection definition with init(), apply(), and store
   * @param options - Optional configuration for projection processing
   * @returns Builder instance for method chaining
   */
  withFoldProjection<ProjectionName extends string>(
    name: ProjectionName,
    definition: FoldProjectionDefinition<any, EventType>,
    options?: FoldProjectionOptions,
  ): StaticPipelineBuilderWithNameAndType<
    EventType,
    RegisteredProjections,
    RegisteredCommands,
    FoldNames | ProjectionName,
    MapNames
  > {
    if (this.foldProjections.has(name)) {
      throw new ConfigurationError(
        "StaticPipelineBuilder",
        `Fold projection with name "${name}" already exists`,
        { projectionName: name },
      );
    }

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
    MapNames | MapName
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
   * per-key lock. It is intentionally not a valid parent for `.withReactor()`.
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
  withSubscriber<Fold extends FoldNames & string>(
    subscriberName: string,
    spec: SubscriberSpec<EventType> & {
      fold: Fold;
      handler: (
        event: EventType,
        context: TriggerContext<RegisteredProjections[Fold]>,
      ) => Promise<void>;
    },
  ): this;
  withSubscriber(
    subscriberName: string,
    spec: SubscriberSpec<EventType>,
  ): this;
  withSubscriber(
    subscriberName: string,
    spec: SubscriberSpec<EventType>,
  ): this {
    const nameTaken =
      this.eventSubscribers.has(subscriberName) ||
      this.foldReactors.has(subscriberName) ||
      this.mapReactors.has(subscriberName);
    if (nameTaken) {
      throw new ConfigurationError(
        "StaticPipelineBuilder",
        `Subscriber with name "${subscriberName}" already exists`,
        { subscriberName },
      );
    }

    if (spec.fold !== undefined || spec.map !== undefined) {
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
      const eventFilter =
        spec.events !== undefined ? new Set<string>(spec.events) : null;
      const passes = (event: EventType): boolean => {
        if (eventFilter && !eventFilter.has(event.type)) return false;
        return spec.when?.(event) ?? true;
      };
      const definition: ReactorDefinition<EventType> = {
        name: subscriberName,
        options: {
          makeJobId: (payload: { event: Event; foldState: unknown }) =>
            spec.dedupId
              ? `subscriber:${subscriberName}:${spec.dedupId(payload.event as EventType)}`
              : `subscriber:${subscriberName}:${payload.event.tenantId}:${String(payload.event.aggregateId)}`,
          ttl: spec.ttl ?? 30_000,
          delay: spec.delay ?? 0,
        },
        // Pre-enqueue rejection: a filtered event never pays serialization.
        shouldReact: passes,
        handle: async (event, context) => {
          if (!passes(event)) return;
          await spec.handler(event, {
            tenantId: context.tenantId,
            aggregateId: context.aggregateId,
            state: context.foldState,
          });
        },
      };
      if (isFold) {
        this.foldReactors.set(subscriberName, { projectionName, definition });
      } else {
        this.mapReactors.set(subscriberName, { projectionName, definition });
      }
      return this;
    }

    this.eventSubscribers.set(subscriberName, {
      name: subscriberName,
      eventTypes: spec.events ?? [],
      options: {
        delay: spec.delay,
        deduplication: spec.dedup,
      },
      handle: async (event, context) => {
        if (spec.when && !spec.when(event)) return;
        await spec.handler(event, {
          tenantId: context.tenantId,
          aggregateId: context.aggregateId,
          state: undefined,
        });
      },
    });
    return this;
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
  withProcessManager(definition: ProcessManagerDefinition<any, any, any, any>): this;
  withProcessManager(
    definitionOrName: ProcessManagerDefinition<any, any, any, any> | string,
    applier?: ProcessManagerApplier<EventType>,
  ): this {
    const definition =
      typeof definitionOrName === "string"
        ? buildProcessManager(definitionOrName, applier!)
        : definitionOrName;
    const name = definition.config.name;
    if (this.processManagers.has(name)) {
      throw new ConfigurationError(
        "StaticPipelineBuilder",
        `Process manager "${name}" already declared on this pipeline`,
        { name },
      );
    }
    for (const trigger of definition.config.triggers) {
      if (trigger.fold !== undefined && !this.foldProjections.has(trigger.fold)) {
        throw new ConfigurationError(
          "StaticPipelineBuilder",
          `Process manager "${name}" trigger fold "${trigger.fold}" — projection not found on this pipeline`,
          { name, projectionName: trigger.fold },
        );
      }
      if (trigger.map !== undefined && !this.mapProjections.has(trigger.map)) {
        throw new ConfigurationError(
          "StaticPipelineBuilder",
          `Process manager "${name}" trigger map "${trigger.map}" — projection not found on this pipeline`,
          { name, projectionName: trigger.map },
        );
      }
    }
    this.processManagers.set(name, definition);
    return this;
  }

  /**
   * Register a reactor on a fold or map projection.
   * A reactor is a post-projection side-effect handler that fires after the
   * projection's processing succeeds.
   *
   * @param projectionName - Name of the fold or map projection this reactor is attached to
   * @param reactorName - Unique name for this reactor within the pipeline
   * @param definition - Reactor definition with handle function
   * @returns Builder instance for method chaining
   */
  withReactor(
    projectionName: FoldNames | MapNames,
    reactorName: string,
    definition: ReactorDefinition<EventType>,
  ): this {
    const nameTaken =
      this.foldReactors.has(reactorName) || this.mapReactors.has(reactorName);
    if (nameTaken) {
      throw new ConfigurationError(
        "StaticPipelineBuilder",
        `Reactor with name "${reactorName}" already exists`,
        { reactorName },
      );
    }

    if (this.foldProjections.has(projectionName)) {
      this.foldReactors.set(reactorName, { projectionName, definition });
    } else if (this.mapProjections.has(projectionName)) {
      this.mapReactors.set(reactorName, { projectionName, definition });
    } else {
      throw new ConfigurationError(
        "StaticPipelineBuilder",
        `Cannot register reactor "${reactorName}" on projection "${projectionName}" — projection not found`,
        { projectionName, reactorName },
      );
    }

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
    MapNames
  > {
    if (this.commands.some((c) => c.name === name)) {
      throw new ConfigurationError(
        "StaticPipelineBuilder",
        `Command handler with name "${name}" already exists`,
        { commandHandlerName: name },
      );
    }

    this.commands.push({ name, handlerClass: handlerClass, options });
    return this as StaticPipelineBuilderWithNameAndType<
      EventType,
      RegisteredProjections,
      | RegisteredCommands
      | { name: Name; payload: ExtractCommandHandlerPayload<handlerClass> },
      FoldNames,
      MapNames
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
    MapNames
  > {
    if (this.commands.some((c) => c.name === name)) {
      throw new ConfigurationError(
        "StaticPipelineBuilder",
        `Command handler with name "${name}" already exists`,
        { commandHandlerName: name },
      );
    }

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
      MapNames
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
      foldReactors: this.foldReactors,
      mapReactors: this.mapReactors,
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
