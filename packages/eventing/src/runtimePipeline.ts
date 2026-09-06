import { createLogger } from "@langwatch/observability";
import type { AggregateType } from "./domain/aggregateType.ts";
import type { Event, Projection } from "./domain/types.ts";
import type {
  EventSourcingPipelineDefinition,
  PipelineMetadata,
  RegisteredPipeline,
} from "./pipeline/types.ts";
import { EventSourcingService } from "./services/eventSourcingService.ts";

const pipelineLogger = createLogger("langwatch:event-sourcing:pipeline");

export class EventSourcingPipeline<
  EventType extends Event = Event,
  ProjectionTypes extends Record<string, Projection> = Record<string, Projection>,
> implements RegisteredPipeline<EventType, ProjectionTypes> {
  public readonly name: string;
  public readonly aggregateType: AggregateType;
  public readonly service: EventSourcingService<EventType, ProjectionTypes>;
  public readonly metadata: PipelineMetadata;

  constructor(
    definition: EventSourcingPipelineDefinition<EventType, ProjectionTypes> & {
      metadata?: PipelineMetadata;
    },
  ) {
    this.name = definition.name;
    this.aggregateType = definition.aggregateType;
    this.metadata = definition.metadata ?? {
      name: definition.name,
      aggregateType: definition.aggregateType,
      allowedEventTypes: definition.allowedEventTypes,
      projections: [],
      mapProjections: [],
      commands: [],
    };

    pipelineLogger.debug({ pipelineName: definition.name }, "Initialized event-sourcing pipeline");

    this.service = new EventSourcingService<EventType, ProjectionTypes>({
      pipelineName: definition.name,
      aggregateType: definition.aggregateType,
      allowedEventTypes: definition.allowedEventTypes,
      eventStore: definition.eventStore,
      foldProjections: definition.foldProjections,
      stateProjections: definition.stateProjections,
      mapProjections: definition.mapProjections,
      foldSubscribers: definition.foldSubscribers,
      mapSubscribers: definition.mapSubscribers,
      subscribers: definition.subscribers,
      globalQueue: definition.globalQueue,
      globalJobRegistry: definition.globalJobRegistry,
      commandRegistrations: definition.commandRegistrations,
      globalRegistry: definition.globalRegistry,
      executionTarget: definition.executionTarget,
      replayMarkerChecker: definition.replayMarkerChecker,
      retentionPolicyResolver: definition.retentionPolicyResolver,
      killSwitch: definition.killSwitch,
      prepareEventForProjection: definition.prepareEventForProjection,
      warnWhenProjectionsRunInline: definition.warnWhenProjectionsRunInline,
    });
  }
}
