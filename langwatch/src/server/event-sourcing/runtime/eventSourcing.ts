import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type {
  Event,
  EventSourcedQueueProcessor,
  EventStore,
  Projection,
  StaticPipelineDefinition,
} from "../library";

import type { NoCommands, RegisteredCommand } from "../library/pipeline/types";
import { evaluationProcessingPipelineDefinition } from "../pipelines/evaluation-processing/pipeline";
import { experimentRunProcessingPipelineDefinition } from "../pipelines/experiment-run-processing/pipeline";
import { traceProcessingPipelineDefinition } from "../pipelines/trace-processing/pipeline";
import { DisabledPipeline } from "./disabledPipeline";
import type { EventSourcingRuntime } from "./eventSourcingRuntime";
import { getEventSourcingRuntime } from "./eventSourcingRuntime";
import { getGlobalProjectionRegistry } from "../projections/global/registry";
import { EventSourcingPipeline } from "./pipeline";
import type {
  PipelineWithCommandHandlers,
  RegisteredPipeline,
} from "./pipeline/types";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:event-sourcing:register");

/**
 * Type helper to convert registered commands union to a record of queue processors.
 */
type CommandsToProcessors<Commands extends RegisteredCommand> = {
  [K in Commands as K["name"]]: EventSourcedQueueProcessor<K["payload"]>;
};

/**
 * Singleton that manages shared event sourcing infrastructure.
 */
export class EventSourcing {
  private static instance: EventSourcing | null = null;
  private readonly tracer = getLangWatchTracer(
    "langwatch.event-sourcing.runtime",
  );
  constructor(
    private readonly runtime: EventSourcingRuntime = getEventSourcingRuntime(),
  ) {}

  get isEnabled(): boolean {
    return this.runtime.isEnabled;
  }

  static getInstance(): EventSourcing {
    if (!EventSourcing.instance) {
      EventSourcing.instance = new EventSourcing();
    }
    return EventSourcing.instance;
  }

  static resetInstance(): void {
    EventSourcing.instance = null;
  }

  getEventStore<EventType extends Event>(): EventStore<EventType> | undefined {
    return this.runtime.eventStore as EventStore<EventType> | undefined;
  }

  /**
   * Registers a static pipeline definition with the runtime infrastructure.
   * Takes a static definition (created with `definePipeline()`) and connects it
   * to ClickHouse, Redis, and other runtime dependencies.
   */
  register<
    EventType extends Event,
    ProjectionTypes extends Record<string, Projection>,
    Commands extends RegisteredCommand = NoCommands,
  >(
    definition: StaticPipelineDefinition<EventType, ProjectionTypes, Commands>,
  ): PipelineWithCommandHandlers<
    RegisteredPipeline<EventType, ProjectionTypes>,
    [Commands] extends [NoCommands]
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
        type ReturnType = PipelineWithCommandHandlers<
          RegisteredPipeline<EventType, ProjectionTypes>,
          [Commands] extends [NoCommands]
            ? Record<string, EventSourcedQueueProcessor<any>>
            : CommandsToProcessors<Commands>
        >;

        if (
          !this.runtime.isEnabled ||
          !this.runtime.eventStore
        ) {
          logger.warn(
            {
              pipeline: definition.metadata.name,
              isEnabled: this.runtime.isEnabled,
              hasEventStore: !!this.runtime.eventStore,
            },
            "Returning DisabledPipeline - commands will be silently dropped",
          );
          this.runtime.logDisabledWarning({
            pipeline: definition.metadata.name,
          });
          return new DisabledPipeline<EventType, ProjectionTypes>(
            definition.metadata.name,
            definition.metadata.aggregateType,
            definition.metadata,
          ) as ReturnType;
        }

        const eventStore = this.runtime.eventStore as EventStore<EventType>;

        // Convert fold projection definitions to arrays for the service
        const foldProjections = Array.from(definition.foldProjections.values()).map(
          ({ definition: fold, options }) => ({
            ...fold,
            options: options ?? fold.options,
          }),
        );

        // Convert map projection definitions to arrays for the service
        const mapProjections = Array.from(definition.mapProjections.values()).map(
          ({ definition: mapProj, options }) => ({
            ...mapProj,
            options: options ?? mapProj.options,
          }),
        );

        // Build command registrations for the service
        const commandRegistrations =
          definition.commands.length > 0
            ? definition.commands.map((cmd) => ({
                name: cmd.name,
                handlerClass: cmd.handlerClass,
                options: cmd.options,
              }))
            : undefined;

        // Initialize the global projection registry if it has projections and hasn't been initialized yet
        const globalRegistry = getGlobalProjectionRegistry();
        if (
          globalRegistry.hasProjections &&
          !globalRegistry.isInitialized &&
          this.runtime.queueProcessorFactory
        ) {
          globalRegistry.initialize(this.runtime.queueProcessorFactory);
        }

        // Create the pipeline using the new service options
        const pipeline = new EventSourcingPipeline<EventType, ProjectionTypes>({
          name: definition.metadata.name,
          aggregateType: definition.metadata.aggregateType,
          eventStore,
          foldProjections: foldProjections.length > 0 ? foldProjections : undefined,
          mapProjections: mapProjections.length > 0 ? mapProjections : undefined,
          queueProcessorFactory: this.runtime.queueProcessorFactory,
          parentLinks:
            definition.parentLinks.length > 0
              ? definition.parentLinks
              : undefined,
          metadata: definition.metadata,
          featureFlagService: definition.featureFlagService,
          commandRegistrations,
          globalRegistry,
          redisConnection: this.runtime.redisConnection,
        });

        // Get command dispatchers
        const commandProcessors = pipeline.service.getCommandQueues();
        const dispatchers: Record<string, EventSourcedQueueProcessor<any>> = {};
        for (const [commandName, processor] of commandProcessors.entries()) {
          dispatchers[commandName] = processor;
        }

        return Object.assign(pipeline, {
          commands: dispatchers,
        }) as ReturnType;
      },
    );
  }
}

let _eventSourcingInstance: EventSourcing | null = null;

export function getEventSourcing(): EventSourcing {
  if (!_eventSourcingInstance) {
    _eventSourcingInstance = EventSourcing.getInstance();
  }
  return _eventSourcingInstance;
}

function createLazyPipeline<T>(factory: () => T): () => T {
  let instance: T | null = null;
  return () => {
    if (!instance) {
      instance = factory();
    }
    return instance;
  };
}

export const getTraceProcessingPipeline = createLazyPipeline(() =>
  getEventSourcing().register(traceProcessingPipelineDefinition),
);

export const getEvaluationProcessingPipeline = createLazyPipeline(() =>
  getEventSourcing().register(evaluationProcessingPipelineDefinition),
);

export const getExperimentRunProcessingPipeline = createLazyPipeline(() =>
  getEventSourcing().register(experimentRunProcessingPipelineDefinition),
);
