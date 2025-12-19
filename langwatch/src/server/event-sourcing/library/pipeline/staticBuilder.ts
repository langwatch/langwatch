import type { AggregateType } from "../domain/aggregateType";
import type {
  CommandHandlerClass,
  ExtractCommandHandlerPayload,
} from "../commands/commandHandlerClass";
import type { EventHandlerClass } from "../domain/handlers/eventHandlerClass";
import type {
  ExtractProjectionHandlerProjection,
  ProjectionHandlerClass,
} from "../domain/handlers/projectionHandlerClass";
import type { Event, ParentLink, Projection } from "../domain/types";
import type { EventHandlerOptions } from "../eventHandler.types";
import type { PipelineMetadata } from "../../runtime/pipeline/types";
import type { ProjectionOptions, ProjectionTypeMap } from "../projection.types";
import { ConfigurationError } from "../services/errorHandling";
import type {
  CommandHandlerOptions,
  NoCommands,
  RegisteredCommand,
  StaticPipelineDefinition,
} from "./types";
import type { FeatureFlagServiceInterface } from "../../../featureFlag/types";

/**
 * Builder for creating static pipeline definitions without runtime dependencies.
 * Use `definePipeline()` to start building a pipeline.
 *
 * @example
 * ```typescript
 * const pipeline = definePipeline<MyEvent>()
 *   .withName("my-pipeline")
 *   .withAggregateType("entity")
 *   .withProjection("summary", SummaryHandler)
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
    ProjectionTypeMap,
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
  RegisteredProjections extends ProjectionTypeMap = ProjectionTypeMap,
  RegisteredCommands extends RegisteredCommand = NoCommands,
  RegisteredHandlers extends string = never,
> {
  // Combined type for all available dependencies (projections + event handlers)
  private get availableDependencies(): (keyof RegisteredProjections) | RegisteredHandlers {
    return {} as any; // Type-only, runtime not needed
  }
  private projections = new Map<
    string,
    {
      HandlerClass: ProjectionHandlerClass<EventType, any>;
      options?: ProjectionOptions;
    }
  >();
  private eventHandlers = new Map<
    string,
    {
      HandlerClass: EventHandlerClass<EventType>;
      options?: EventHandlerOptions<EventType, string>;
    }
  >();
  private commands: Array<{
    name: string;
    HandlerClass: CommandHandlerClass<any, any, EventType>;
    options?: CommandHandlerOptions;
  }> = [];
  private parentLinks: Array<ParentLink<EventType>> = [];
  private featureFlagService?: FeatureFlagServiceInterface;

  constructor(
    private readonly name: string,
    private readonly aggregateType: AggregateType,
  ) {}

  /**
   * Register a projection handler class with a unique name.
   *
   * @param name - Unique name for this projection within the pipeline
   * @param HandlerClass - Projection handler class to register
   * @param options - Optional configuration for projection processing
   * @returns Builder instance for method chaining
   */
  withProjection<
    HandlerClass extends ProjectionHandlerClass<EventType, any>,
    ProjectionName extends string,
  >(
    name: ProjectionName,
    HandlerClass: HandlerClass,
    options?: ProjectionOptions,
  ): StaticPipelineBuilderWithNameAndType<
    EventType,
    RegisteredProjections & {
      [K in ProjectionName]: ExtractProjectionHandlerProjection<HandlerClass>;
    },
    RegisteredCommands
  > {
    if (this.projections.has(name)) {
      throw new ConfigurationError(
        "StaticPipelineBuilder",
        `Projection with name "${name}" already exists`,
        { projectionName: name },
      );
    }

    this.projections.set(name, { HandlerClass, options });

    return this as StaticPipelineBuilderWithNameAndType<
      EventType,
      RegisteredProjections & {
        [K in ProjectionName]: ExtractProjectionHandlerProjection<HandlerClass>;
      },
      RegisteredCommands
    >;
  }

  /**
   * Register a parent link to another aggregate type.
   *
   * @param targetAggregateType - The aggregate type of the parent
   * @param extractParentId - Function to extract the parent aggregate ID from an event
   * @returns Builder instance for method chaining
   */
  withParentLink(
    targetAggregateType: AggregateType,
    extractParentId: (event: EventType) => string | null,
  ): this {
    this.parentLinks.push({
      targetAggregateType,
      extractParentId,
    });
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
   * Register an event handler class that reacts to individual events.
   *
   * @param name - Unique name for this handler within the pipeline
   * @param HandlerClass - Event handler class to register
   * @param options - Options for configuring the handler
   * @returns Builder instance for method chaining
   */
  withEventHandler<
    HandlerClass extends EventHandlerClass<EventType>,
    HandlerName extends string,
  >(
    name: HandlerName,
    HandlerClass: HandlerClass,
    options?: EventHandlerOptions<EventType, string>,
  ): StaticPipelineBuilderWithNameAndType<
    EventType,
    RegisteredProjections,
    RegisteredCommands,
    RegisteredHandlers | HandlerName
  > {
    if (this.eventHandlers.has(name)) {
      throw new ConfigurationError(
        "StaticPipelineBuilder",
        `Event handler with name "${name}" already exists`,
        { handlerName: name },
      );
    }

    this.eventHandlers.set(name, { HandlerClass, options });
    return this as StaticPipelineBuilderWithNameAndType<
      EventType,
      RegisteredProjections,
      RegisteredCommands,
      RegisteredHandlers | HandlerName
    >;
  }

  /**
   * Register a command handler class.
   *
   * @param name - Unique name for this command handler within the pipeline
   * @param HandlerClass - The command handler class to register
   * @param options - Optional configuration
   * @returns Builder instance for method chaining
   */
  withCommand<
    HandlerClass extends CommandHandlerClass<any, any, EventType>,
    Name extends string,
  >(
    name: Name,
    HandlerClass: HandlerClass,
    options?: CommandHandlerOptions,
  ): StaticPipelineBuilderWithNameAndType<
    EventType,
    RegisteredProjections,
    | RegisteredCommands
    | { name: Name; payload: ExtractCommandHandlerPayload<HandlerClass> }
  > {
    if (this.commands.some((c) => c.name === name)) {
      throw new ConfigurationError(
        "StaticPipelineBuilder",
        `Command handler with name "${name}" already exists`,
        { commandHandlerName: name },
      );
    }

    this.commands.push({ name, HandlerClass, options });
    return this as StaticPipelineBuilderWithNameAndType<
      EventType,
      RegisteredProjections,
      | RegisteredCommands
      | { name: Name; payload: ExtractCommandHandlerPayload<HandlerClass> }
    >;
  }

  /**
   * Build the static pipeline definition.
   * This creates metadata and stores handler classes but does not connect to runtime infrastructure.
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
      projections: Array.from(this.projections.entries()).map(
        ([name, def]) => ({
          name,
          handlerClassName: def.HandlerClass.name,
        }),
      ),
      eventHandlers: Array.from(this.eventHandlers.entries()).map(
        ([name, def]) => ({
          name,
          handlerClassName: def.HandlerClass.name,
          eventTypes: def.options?.eventTypes as string[] | undefined,
        }),
      ),
      commands: this.commands.map((cmd) => ({
        name: cmd.name,
        handlerClassName: cmd.HandlerClass.name,
      })),
    };

    return {
      metadata,
      projections: this.projections,
      eventHandlers: this.eventHandlers,
      commands: this.commands,
      parentLinks: this.parentLinks,
      featureFlagService: this.featureFlagService,
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
 *   .withProjection("summary", SummaryHandler)
 *   .build();
 * ```
 */
export function definePipeline<
  EventType extends Event,
>(): StaticPipelineBuilder<EventType> {
  return new StaticPipelineBuilder<EventType>();
}
