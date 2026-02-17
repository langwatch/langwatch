import { createLogger } from "~/utils/logger/server";
import type { AggregateType, Event, ParentLink, Projection } from "../library";
import { EventSourcingService } from "../library";
import type {
  EventSourcingPipelineDefinition,
  PipelineMetadata,
  RegisteredPipeline,
} from "./pipeline/types";

const pipelineLogger = createLogger("langwatch:event-sourcing:pipeline");

export class EventSourcingPipeline<
  EventType extends Event = Event,
  ProjectionTypes extends Record<string, Projection> = Record<
    string,
    Projection
  >,
> implements RegisteredPipeline<EventType, ProjectionTypes> {
  public readonly name!: string;
  public readonly aggregateType!: AggregateType;
  public readonly service!: EventSourcingService<EventType, ProjectionTypes>;
  public readonly parentLinks!: ParentLink<EventType>[];
  public readonly metadata!: PipelineMetadata;

  constructor(
    definition: EventSourcingPipelineDefinition<EventType, ProjectionTypes> & {
      metadata?: PipelineMetadata;
    },
  ) {
    if (!definition.metadata) {
      definition.metadata = {
        name: definition.name,
        aggregateType: definition.aggregateType,
        projections: [],
        eventHandlers: [],
        commands: [],
      };
    }

    Object.defineProperty(this, "name", {
      value: definition.name,
      writable: false,
      enumerable: true,
      configurable: false,
    });
    Object.defineProperty(this, "aggregateType", {
      value: definition.aggregateType,
      writable: false,
      enumerable: true,
      configurable: false,
    });
    Object.defineProperty(this, "parentLinks", {
      value: definition.parentLinks ?? [],
      writable: false,
      enumerable: true,
      configurable: false,
    });
    Object.defineProperty(this, "metadata", {
      value: definition.metadata,
      writable: false,
      enumerable: true,
      configurable: false,
    });

    pipelineLogger.debug(
      {
        pipelineName: definition.name,
      },
      "Initialized event-sourcing pipeline",
    );

    Object.defineProperty(this, "service", {
      value: new EventSourcingService<EventType, ProjectionTypes>({
        pipelineName: definition.name,
        aggregateType: definition.aggregateType,
        eventStore: definition.eventStore,
        foldProjections: definition.foldProjections,
        mapProjections: definition.mapProjections,
        eventPublisher: definition.eventPublisher,
        queueFactory: definition.queueProcessorFactory,
        featureFlagService: definition.featureFlagService,
        commandRegistrations: definition.commandRegistrations,
        globalRegistry: definition.globalRegistry,
        redisConnection: definition.redisConnection,
      }),
      writable: false,
      enumerable: true,
      configurable: false,
    });
  }
}
