import type { createLogger } from "@langwatch/observability";
import type { CommandHandlerClass } from "../commands/commandHandlerClass";
import type { AggregateType } from "../domain/aggregateType";
import type { Event, EventOrderingStrategy } from "../domain/types";
import type { FoldProjectionDefinition } from "../projections/foldProjection.types";
import type { MapProjectionDefinition } from "../projections/mapProjection.types";
import type { ProjectionRegistry } from "../projections/projectionRegistry";
import type { ReplayMarkerChecker } from "../projections/replayMarkerCheck";
import type { StateProjectionDefinition } from "../projections/stateProjection.types";
import type { EventSourcedQueueProcessor } from "../queues";
import type { EventStore } from "../stores/eventStore.types";
import type { EventSubscriberDefinition } from "../subscribers/eventSubscriber.types";
import type { SubscriberDispatchDefinition } from "../subscribers/subscriber.types";
import type { CommandHandlerOptions } from "./commands/commandDispatcher";
import type { JobRegistryEntry } from "./queues/queueManager";
import type { ExecutionTarget, RetentionPolicyResolver } from "../runtime.types";

/**
 * Options for configuring event sourcing behavior.
 */
export interface EventSourcingOptions<EventType extends Event = Event> {
  /**
   * Strategy for ordering events when building projections.
   * Defaults to "createdAt" (chronological order).
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
  /** Complete event vocabulary owned by the aggregate. */
  allowedEventTypes: readonly string[];
  /**
   * Event store for persisting and retrieving events.
   */
  eventStore: EventStore<EventType>;
  /**
   * Fold projections (stateful, reduce events into accumulated state).
   */
  foldProjections?: FoldProjectionDefinition<any, EventType>[];
  /** Default operational projections (direct store load/apply/store). */
  stateProjections?: StateProjectionDefinition<any, EventType>[];
  /**
   * Map projections (stateless, transform individual events into records).
   */
  mapProjections?: MapProjectionDefinition<any, EventType>[];
  /**
   * Service-level options (e.g., event ordering strategy).
   */
  serviceOptions?: EventSourcingOptions<EventType>;
  /**
   * Optional logger for logging events and errors.
   */
  logger?: ReturnType<typeof createLogger>;
  /** Optional application-owned transform used to keep projection queue payloads lean. */
  prepareEventForProjection?: (event: EventType) => EventType;
  /** Optional metrics sink. The framework never imports application metrics. */
  metrics?: {
    eventsStored(pipelineName: string, count: number): void;
    storeDuration(pipelineName: string, durationMs: number): void;
  };
  /**
   * Global queue processor shared across all pipelines.
   */
  globalQueue?: EventSourcedQueueProcessor<Record<string, unknown>>;
  /**
   * Global job registry shared across all pipelines.
   */
  globalJobRegistry?: Map<string, JobRegistryEntry>;
  /**
   * Command handler registrations for this pipeline.
   */
  commandRegistrations?: Array<{
    name: string;
    handlerClass: CommandHandlerClass<any, any, EventType>;
    options?: CommandHandlerOptions<unknown>;
  }>;
  /**
   * Subscribers (post-fold side-effect handlers) for this pipeline.
   *
   * `ReadonlyArray` because the service only reads it — `length` and one
   * `for…of` — and a caller assembling its list with `as const` should not
   * have to widen it back to satisfy a parameter nothing writes to.
   */
  foldSubscribers?: ReadonlyArray<{
    foldName: string;
    definition: SubscriberDispatchDefinition<EventType>;
  }>;
  /**
   * Subscribers (post-map side-effect handlers) for this pipeline.
   */
  mapSubscribers?: ReadonlyArray<{
    mapName: string;
    definition: SubscriberDispatchDefinition<EventType>;
  }>;
  /** Live event-only consumers, independent of projection state. */
  subscribers?: EventSubscriberDefinition<EventType>[];
  /**
   * Optional global projection registry for cross-pipeline projections.
   * When provided, events are dispatched to global projections after local dispatch.
   * Uses base Event type because the registry receives events from all pipelines.
   */
  globalRegistry?: ProjectionRegistry<Event>;
  /**
   * Process role — controls whether queue consumers are started.
   * "web": skip queue consumers (only dispatch to queues)
   * "worker" | undefined: start all consumers
   */
  executionTarget?: ExecutionTarget;
  /**
   * Optional replay marker checker for coordinating with projection-replay.
   * When provided, fold projections check for active replay markers before
   * processing events, deferring or skipping as needed.
   */
  replayMarkerChecker?: ReplayMarkerChecker;
  retentionPolicyResolver?: RetentionPolicyResolver;
  /**
   * Process composition enables this for production workers and API processes.
   * It keeps an accidentally inline projection visible without Eventing reading
   * the host environment.
   */
  warnWhenProjectionsRunInline?: boolean;
}
