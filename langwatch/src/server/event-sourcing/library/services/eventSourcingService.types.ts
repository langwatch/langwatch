import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import type { createLogger } from "../../../../utils/logger/server";
import type { FeatureFlagServiceInterface } from "../../../featureFlag/types";
import type { CommandHandlerClass } from "../commands/commandHandlerClass";
import type { AggregateType } from "../domain/aggregateType";
import type { Event, EventOrderingStrategy } from "../domain/types";
import type { FoldProjectionDefinition } from "../projections/foldProjection.types";
import type { MapProjectionDefinition } from "../projections/mapProjection.types";
import type { ProjectionRegistry } from "../projections/projectionRegistry";
import type { EventPublisher } from "../eventPublisher.types";
import type { QueueProcessorFactory } from "../queues";
import type { EventStore } from "../stores/eventStore.types";
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
  /**
   * Optional global projection registry for cross-pipeline projections.
   * When provided, events are dispatched to global projections after local dispatch.
   * Uses base Event type because the registry receives events from all pipelines.
   */
  globalRegistry?: ProjectionRegistry<Event>;
  /**
   * Optional Redis connection for projection replay marker checks.
   * Falls back to the global singleton if not provided.
   */
  redisConnection?: IORedis | Cluster;
}
