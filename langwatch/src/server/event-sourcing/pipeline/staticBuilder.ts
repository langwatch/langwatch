import type {
  CommandHandlerOptions,
  NoCommands, PipelineMetadata, RegisteredCommand,
  StaticPipelineDefinition
} from "..";
import type { FeatureFlagServiceInterface } from "../../featureFlag/types";
import type {
  CommandHandlerClass,
  ExtractCommandHandlerPayload,
} from "../commands/commandHandlerClass";
import type { AggregateType } from "../domain/aggregateType";
import type { Event, Projection } from "../domain/types";
import type { FoldProjectionDefinition, FoldProjectionOptions } from "../projections/foldProjection.types";
import type { MapProjectionDefinition, MapProjectionOptions } from "../projections/mapProjection.types";
import type { ReactorDefinition } from "../reactors/reactor.types";
import { ConfigurationError } from "../services/errorHandling";

// Turns a union like {name:"a"; payload:A} | {name:"b"; payload:B}
// into a record { a: A; b: B }
export type CommandsUnionToRegistry<C extends RegisteredCommand> = {
  [K in C as K extends { name: infer N extends string } ? N : never]:
    K extends { payload: infer P } ? P : never;
};

// fooking proud of this one, still got it, take that ai
// The way TypeScript has elected for us to suffer for the simply joy in life, of
// obtaining the typed keys of a Map. fanks.
type MapKey<T> = T extends Map<infer K, any> ? K : never;

// Convenience: command name union from a StaticPipelineDefinition
export type CommandNamesFromPipeline<
  P extends StaticPipelineDefinition<any, any, any>
> = keyof CommandsUnionToRegistry<P extends StaticPipelineDefinition<any, any, infer C> ? C : never>;

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
    NoCommands
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
  RegisteredProjections extends Record<string, Projection> = Record<string, Projection>,
  RegisteredCommands extends RegisteredCommand = NoCommands,
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
  private commands: Array<{
    name: string;
    handlerClass: CommandHandlerClass<any, any, EventType>;
    options?: CommandHandlerOptions;
  }> = [];
  private reactors = new Map<
    string,
    { foldName: string; definition: ReactorDefinition<EventType> }
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
    RegisteredCommands
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
    RegisteredCommands
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

  /**
   * Register a reactor on a fold projection.
   * A reactor is a post-fold side-effect handler that fires after the fold's
   * apply + store succeeds.
   *
   * @param foldName - Name of the fold projection this reactor is attached to
   * @param reactorName - Unique name for this reactor within the pipeline
   * @param definition - Reactor definition with handle function
   * @returns Builder instance for method chaining
   */
  withReactor(
    foldName: MapKey<typeof this.foldProjections>,
    reactorName: string,
    definition: ReactorDefinition<EventType>,
  ): this {
    if (!this.foldProjections.has(foldName)) {
      throw new ConfigurationError(
        "StaticPipelineBuilder",
        `Cannot register reactor "${reactorName}" on fold "${foldName}" — fold not found`,
        { foldName, reactorName },
      );
    }

    if (this.reactors.has(reactorName)) {
      throw new ConfigurationError(
        "StaticPipelineBuilder",
        `Reactor with name "${reactorName}" already exists`,
        { reactorName },
      );
    }

    this.reactors.set(reactorName, { foldName, definition });
    return this;
  }

  /**
   * Register a command handler class.
   *
   * @param name - Unique name for this command handler within the pipeline
   * @param handlerClass - The command handler class to register
   * @param options - Optional configuration
   * @returns Builder instance for method chaining
   */
  withCommand<
    handlerClass extends CommandHandlerClass<any, any, EventType>,
    Name extends string,
  >(
    name: Name,
    handlerClass: handlerClass,
    options?: CommandHandlerOptions,
  ): StaticPipelineBuilderWithNameAndType<
    EventType,
    RegisteredProjections,
    | RegisteredCommands
    | { name: Name; payload: ExtractCommandHandlerPayload<handlerClass> }
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
      | { name: Name; payload: ExtractCommandHandlerPayload<handlerClass> }
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
      commands: this.commands.map((cmd) => ({
        name: cmd.name,
        handlerClassName: cmd.handlerClass.name,
      })),
    };

    return {
      metadata,
      foldProjections: this.foldProjections,
      mapProjections: this.mapProjections,
      commands: this.commands,
      reactors: this.reactors,
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
