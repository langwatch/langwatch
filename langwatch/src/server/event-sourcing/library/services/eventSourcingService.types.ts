import type { createLogger } from "../../../../utils/logger/server";
import type { FeatureFlagServiceInterface } from "../../../featureFlag/types";
import type { CommandHandlerClass } from "../commands/commandHandlerClass";
import type { AggregateType } from "../domain/aggregateType";
import type { Event, EventOrderingStrategy } from "../domain/types";
import type { FoldProjectionDefinition } from "../projections/foldProjection.types";
import type { MapProjectionDefinition } from "../projections/mapProjection.types";
import type { EventPublisher } from "../eventPublisher.types";
import type { QueueProcessorFactory } from "../queues";
import type { EventStore } from "../stores/eventStore.types";
import type { ProjectionStoreReadContext } from "../stores/projectionStore.types";
import type { CommandHandlerOptions } from "./commands/commandDispatcher";

/**
 * Options for configuring event sourcing behavior.
 */
export interface EventSourcingOptions<EventType extends Event = Event> {
  /**
   * Strategy for ordering events when building projections.
   * Defaults to "timestamp" (chronological order).
   */
  ordering?: EventOrderingStrategy<EventType>;
}

/**
 * Options for updating a projection.
 */
export interface UpdateProjectionOptions<EventType extends Event = Event> {
  /**
   * Optional projection store context. If not provided, defaults to eventStoreContext.
   * Useful when projection store requires different tenant isolation or permissions.
   */
  projectionStoreContext?: ProjectionStoreReadContext;
  /**
   * Pre-fetched events to avoid duplicate query.
   * If provided, updateProjectionByName will use these events instead of fetching from the event store.
   */
  events?: readonly EventType[];
}

/**
 * Configuration options for EventSourcingService.
 */
export interface EventSourcingServiceOptions<
  EventType extends Event = Event,
  _ProjectionTypes extends Record<string, unknown> = Record<string, unknown>,
> {
  /**
   * The pipeline name for this service.
   */
  pipelineName: string;
  /**
   * The aggregate type this service manages (e.g., "trace", "user").
   */
  aggregateType: AggregateType;
  /**
   * Event store for persisting and retrieving events.
   */
  eventStore: EventStore<EventType>;
  /**
   * Fold projections (stateful, reduce events into accumulated state).
   */
  foldProjections?: FoldProjectionDefinition<any, EventType>[];
  /**
   * Map projections (stateless, transform individual events into records).
   */
  mapProjections?: MapProjectionDefinition<any, EventType>[];
  /**
   * Optional event publisher for publishing events to external systems.
   */
  eventPublisher?: EventPublisher<EventType>;
  /**
   * Service-level options (e.g., event ordering strategy).
   */
  serviceOptions?: EventSourcingOptions<EventType>;
  /**
   * Optional logger for logging events and errors.
   */
  logger?: ReturnType<typeof createLogger>;
  /**
   * Optional queue factory for creating queues for event handlers.
   */
  queueFactory?: QueueProcessorFactory;
  /**
   * Optional feature flag service for kill switches.
   */
  featureFlagService?: FeatureFlagServiceInterface;
  /**
   * Command handler registrations for this pipeline.
   */
  commandRegistrations?: Array<{
    name: string;
    handlerClass: CommandHandlerClass<any, any, EventType>;
    options?: CommandHandlerOptions<unknown>;
  }>;
}
