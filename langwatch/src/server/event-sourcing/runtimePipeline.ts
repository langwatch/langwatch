import { createLogger } from "~/utils/logger/server";
import type { AggregateType } from "./domain/aggregateType";
import type { Event, Projection } from "./domain/types";
import type {
  EventSourcingPipelineDefinition,
  PipelineMetadata,
  RegisteredPipeline,
} from "./pipeline/types";
import { EventSourcingService } from "./services/eventSourcingService";

const pipelineLogger = createLogger("langwatch:event-sourcing:pipeline");

export class EventSourcingPipeline<
  EventType extends Event = Event,
  ProjectionTypes extends Record<string, Projection> = Record<
    string,
    Projection
  >,
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
      projections: [],
      mapProjections: [],
      commands: [],
    };

    pipelineLogger.debug(
      { pipelineName: definition.name },
      "Initialized event-sourcing pipeline",
    );

    this.service = new EventSourcingService<EventType, ProjectionTypes>({
      pipelineName: definition.name,
      aggregateType: definition.aggregateType,
      eventStore: definition.eventStore,
      foldProjections: definition.foldProjections,
      mapProjections: definition.mapProjections,
      reactors: definition.reactors,
      mapReactors: definition.mapReactors,
      globalQueue: definition.globalQueue,
      globalJobRegistry: definition.globalJobRegistry,
      featureFlagService: definition.featureFlagService,
      commandRegistrations: definition.commandRegistrations,
      globalRegistry: definition.globalRegistry,
      processRole: definition.processRole,
    });
  }
}
