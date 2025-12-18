import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { Event, EventStore, Projection, StaticPipelineDefinition } from "../library";
import type { NoCommands, RegisteredCommand } from "../library/pipeline/types";
import { DisabledPipeline } from "./disabledPipeline";
import type { EventSourcingRuntime } from "./eventSourcingRuntime";
import { getEventSourcingRuntime } from "./eventSourcingRuntime";
import { PipelineBuilder } from "./pipeline";
import { EventSourcingPipeline } from "./pipeline";
import type {
  EventStoreReadContext,
  EventSourcedQueueProcessor,
} from "../library";
import type { PipelineWithCommandHandlers, RegisteredPipeline } from "./pipeline/types";

import { traceProcessingPipelineDefinition } from "../pipelines/trace-processing/pipeline";

/**
 * Type helper to convert registered commands union to a record of queue processors.
 * Transforms `{ name: "foo", payload: FooPayload } | { name: "bar", payload: BarPayload }`
 * into `{ foo: EventSourcedQueueProcessor<FooPayload>, bar: EventSourcedQueueProcessor<BarPayload> }`
 */
type CommandsToProcessors<Commands extends RegisteredCommand> = {
  [K in Commands as K["name"]]: EventSourcedQueueProcessor<K["payload"]>;
};

/**
 * Singleton that manages shared event sourcing infrastructure.
 * Provides a single event store instance that can be used by all pipelines,
 * since the database partitions by tenantId + aggregateType.
 */
export class EventSourcing {
  private static instance: EventSourcing | null = null;
  private readonly tracer = getLangWatchTracer(
    "langwatch.event-sourcing.runtime",
  );
  constructor(
    private readonly runtime: EventSourcingRuntime = getEventSourcingRuntime(),
  ) {}

  /**
   * Whether event sourcing is enabled.
   * When false, pipelines will be no-ops that log warnings.
   */
  get isEnabled(): boolean {
    return this.runtime.isEnabled;
  }

  /**
   * Returns the singleton instance of EventSourcing.
   * Creates a new instance with auto-selected stores on first call.
   */
  static getInstance(): EventSourcing {
    if (!EventSourcing.instance) {
      EventSourcing.instance = new EventSourcing();
    }
    return EventSourcing.instance;
  }

  /**
   * Resets the singleton instance. Only use in tests.
   */
  static resetInstance(): void {
    EventSourcing.instance = null;
  }

  /**
   * Returns the shared event store instance.
   *
   * This single instance handles all aggregate types by accepting aggregateType as a method parameter.
   * The store partitions data by tenantId + aggregateType internally, allowing a single instance
   * to serve multiple pipelines efficiently.
   *
   * Returns undefined if event sourcing is disabled.
   */
  getEventStore<EventType extends Event>(): EventStore<EventType> | undefined {
    return this.runtime.eventStore as EventStore<EventType> | undefined;
  }

  /**
   * Creates a pipeline builder for registering a new pipeline.
   * Use this method to build and register pipelines programmatically.
   *
   * @returns A pipeline builder instance
   * @throws Error if event store is not available
   *
   * @example
   * ```typescript
   * const pipeline = eventSourcing.registerPipeline<Event>()
   *   .withName("my-pipeline")
   *   .withAggregateType("entity")
   *   .withProjection("summary", SummaryHandler)
   *   .build();
   * ```
   */
  registerPipeline<EventType extends Event>() {
    const eventStore = this.getEventStore<EventType>();
    if (!eventStore) {
      throw new Error("Event store not available. Event sourcing may be disabled.");
    }

    return new PipelineBuilder<EventType>({
      eventStore,
      queueProcessorFactory: this.runtime.queueProcessorFactory,
      distributedLock: this.runtime.distributedLock,
      processorCheckpointStore: this.runtime.checkpointStore,
    });
  }

  /**
   * Registers a static pipeline definition with the runtime infrastructure.
   * Takes a static definition (created with `definePipeline()`) and connects it
   * to ClickHouse, Redis, and other runtime dependencies.
   *
   * @param definition - Static pipeline definition to register
   * @returns Registered pipeline with runtime connections, or disabled pipeline if runtime unavailable
   *
   * @example
   * ```typescript
   * // In pipeline.ts (static, no side effects)
   * export const myPipeline = definePipeline<MyEvent>()
   *   .withName("my-pipeline")
   *   .withAggregateType("entity")
   *   .withProjection("summary", SummaryHandler)
   *   .build();
   *
   * // In eventSourcing.ts (runtime registration)
   * const registered = eventSourcing.register(myPipeline);
   * ```
   */
  register<
    EventType extends Event,
    ProjectionTypes extends Record<string, Projection>,
    Commands extends RegisteredCommand = NoCommands,
  >(
    definition: StaticPipelineDefinition<EventType, ProjectionTypes, Commands>,
  ): PipelineWithCommandHandlers<
    RegisteredPipeline<EventType, ProjectionTypes>,
    Commands extends NoCommands
      ? Record<string, EventSourcedQueueProcessor<any>>
      : CommandsToProcessors<Commands>
  > {
    return this.tracer.withActiveSpan(
      "EventSourcing.register",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "pipeline.name": definition.metadata.name,
          "pipeline.aggregate_type": definition.metadata.aggregateType,
        },
      },
      () => {
        // Define the return type for cleaner code
        type ReturnType = PipelineWithCommandHandlers<
          RegisteredPipeline<EventType, ProjectionTypes>,
          Commands extends NoCommands
            ? Record<string, EventSourcedQueueProcessor<any>>
            : CommandsToProcessors<Commands>
        >;

        // Return disabled pipeline if event sourcing is disabled
        if (!this.runtime.isEnabled || !this.runtime.eventStore) {
          this.runtime.logDisabledWarning({
            pipeline: definition.metadata.name,
          });
          return new DisabledPipeline<EventType, ProjectionTypes>(
            definition.metadata.name,
            definition.metadata.aggregateType,
            definition.metadata,
          ) as ReturnType;
        }

        // Convert static definition to runtime pipeline
        const eventStore = this.runtime.eventStore as EventStore<EventType>;

        // Instantiate handlers
        const projections = new Map();
        for (const [name, { HandlerClass, options }] of definition.projections) {
          projections.set(name, {
            name,
            store: HandlerClass.store,
            handler: new HandlerClass(),
            options,
          });
        }

        const eventHandlers = new Map();
        for (const [name, { HandlerClass, options }] of definition.eventHandlers) {
          eventHandlers.set(name, {
            name,
            handler: new HandlerClass(),
            options,
          });
        }

        // Build projection definitions object
        const projectionsObject =
          projections.size > 0
            ? Object.fromEntries(Array.from(projections))
            : undefined;

        // Build event handlers object
        const eventHandlersObject =
          eventHandlers.size > 0
            ? Object.fromEntries(Array.from(eventHandlers))
            : undefined;

        // Create the pipeline
        const pipeline = new EventSourcingPipeline<EventType, ProjectionTypes>({
          name: definition.metadata.name,
          aggregateType: definition.metadata.aggregateType,
          eventStore,
          projections: projectionsObject as any,
          eventHandlers: eventHandlersObject as any,
          queueProcessorFactory: this.runtime.queueProcessorFactory,
          distributedLock: this.runtime.distributedLock,
          processorCheckpointStore: this.runtime.checkpointStore,
          parentLinks: definition.parentLinks.length > 0 ? definition.parentLinks : undefined,
          metadata: definition.metadata,
        });

        // Create store events function for command handlers
        const storeEventsFn = async (
          events: EventType[],
          context: EventStoreReadContext<EventType>,
        ) => {
          await pipeline.service.storeEvents(events, context);
        };

        // Initialize command queues
        if (definition.commands.length > 0) {
          const queueManager = pipeline.service.getQueueManager();
          queueManager.initializeCommandQueues(
            definition.commands.map((cmd) => ({
              name: cmd.name,
              HandlerClass: cmd.HandlerClass,
              options: cmd.options,
            })),
            storeEventsFn,
            definition.metadata.name,
          );
        }

        // Get command dispatchers
        const commandProcessors = pipeline.service
          .getQueueManager()
          .getCommandQueueProcessors();
        const dispatchers: Record<string, EventSourcedQueueProcessor<any>> = {};
        for (const [commandName, processor] of commandProcessors.entries()) {
          dispatchers[commandName] = processor;
        }

        // Return pipeline with commands attached
        return Object.assign(pipeline, {
          commands: dispatchers,
        }) as ReturnType;
      },
    );
  }
}

export const eventSourcing = EventSourcing.getInstance();

/**
 * Register the defined pipelines
*/
export const traceProcessingPipeline = eventSourcing.register(
  traceProcessingPipelineDefinition,
);
