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
import { ConfigurationError } from "../services/errorHandling";
import type { EventSubscriberDefinition } from "../subscribers/eventSubscriber.types";
import {
  buildProcessManager,
  type ProcessManagerApplier,
} from "./processBuilder";
import type { ProcessManagerDefinition } from "./processManagerDefinition";

// Turns a union like {name:"a"; payload:A} | {name:"b"; payload:B}
// into a record { a: A; b: B }
type CommandsUnionToRegistry<C extends RegisteredCommand> = {
  [K in C as K extends { name: infer N extends string }
    ? N
    : never]: K extends { payload: infer P } ? P : never;
};

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

class StaticPipelineBuilderWithName<EventType extends Event = Event> {
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
    return new StaticPipelineBuilderWithNameAndType(this.name, aggregateType);
  }

  build(): never {
    throw new ConfigurationError(
      "StaticPipelineBuilder",
      "Aggregate type is required",
    );
  }
}

class StaticPipelineBuilderWithNameAndType<
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
   * per-key lock.
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
