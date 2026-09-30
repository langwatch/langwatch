import { createLogger, type Logger } from "@langwatch/observability";

import type { AggregateType } from "../domain/aggregateType.ts";
import type { Event } from "../domain/types.ts";
import { DispatchError } from "../queues/dispatchError.ts";
import type { EventSourcedQueueProcessor } from "../queues/index.ts";
import type { ExecutionTarget } from "../runtime.types.ts";
import { ConfigurationError } from "../services/errorHandling.ts";
import type { FailedHandoff, HandoffLaneKind } from "../services/handoff/failedHandoff.ts";
import { type JobRegistryEntry, QueueManager } from "../services/queues/queueManager.ts";
import type { EventStoreReadContext } from "../stores/eventStore.types.ts";
import type { EventSubscriberDefinition } from "../subscribers/eventSubscriber.types.ts";
import type { SubscriberDispatchDefinition } from "../subscribers/subscriber.types.ts";
import type { FoldProjectionDefinition } from "./foldProjection.types.ts";
import type { MapProjectionDefinition } from "./mapProjection.types.ts";
import { ProjectionRouter } from "./projectionRouter.ts";
import {
  type SealedFoldProjection,
  type SealedMapProjection,
  sealFoldProjection,
  sealMapProjection,
} from "./sealedProjection.ts";

/**
 * Global projection registry for projections and peer subscribers that take events from
 * other pipelines: no event store, purely incremental, processes live events only.
 */
export class ProjectionRegistry<EventType extends Event = Event> {
  private readonly logger: Logger;
  private readonly foldProjections = new Map<string, SealedFoldProjection<EventType>>();
  private readonly mapProjections = new Map<string, SealedMapProjection<EventType>>();
  private readonly subscribers = new Map<
    string,
    { foldName: string; definition: SubscriberDispatchDefinition<EventType> }
  >();
  private readonly mapSubscriberEntries = new Map<
    string,
    { mapName: string; definition: SubscriberDispatchDefinition<EventType> }
  >();
  private readonly eventSubscribers = new Map<string, EventSubscriberDefinition<EventType>>();
  private router?: ProjectionRouter<EventType>;
  private queueManager?: QueueManager<EventType>;
  private closed = false;

  private readonly parseEvent: (value: unknown) => EventType;
  private readonly start?: () => void;

  constructor({
    parseEvent,
    start,
    logger = createLogger("langwatch:event-sourcing:projection-registry"),
  }: {
    /** Parses a queued event with the schema its own pipeline declared for its type (§9). */
    parseEvent: (value: unknown) => EventType;
    /** Initializes the registry on its first dispatch, once every lane has registered. */
    start?: () => void;
    logger?: Logger;
  }) {
    this.parseEvent = parseEvent;
    this.start = start;
    this.logger = logger;
  }

  /** A peer subscriber (§9): a live consumer of another pipeline's events, on its own lane. */
  registerEventSubscriber(subscriber: EventSubscriberDefinition<EventType>): void {
    const isEventSubscriber = this.eventSubscribers.has(subscriber.name);
    const isSubscriber = this.subscribers.has(subscriber.name);
    const isMapSubscriber = this.mapSubscriberEntries.has(subscriber.name);
    if (isEventSubscriber || isSubscriber || isMapSubscriber) {
      throw new ConfigurationError(
        "ProjectionRegistry",
        `Subscriber "${subscriber.name}" already registered`,
        { subscriberName: subscriber.name },
      );
    }
    this.eventSubscribers.set(subscriber.name, subscriber);
  }

  registerFoldProjection<State>(projection: FoldProjectionDefinition<State, EventType>): void {
    if (this.foldProjections.has(projection.name)) {
      throw new ConfigurationError(
        "ProjectionRegistry",
        `Fold projection "${projection.name}" already registered`,
        { projectionName: projection.name },
      );
    }
    this.foldProjections.set(projection.name, sealFoldProjection(projection));
  }

  registerMapProjection<MapRecord, Own extends Event>(
    projection: MapProjectionDefinition<MapRecord, Own>,
  ): void {
    if (this.mapProjections.has(projection.name)) {
      throw new ConfigurationError(
        "ProjectionRegistry",
        `Map projection "${projection.name}" already registered`,
        { projectionName: projection.name },
      );
    }
    this.mapProjections.set(
      projection.name,
      sealMapProjection<MapRecord, Own, EventType>(projection),
    );
  }

  registerSubscriber(foldName: string, subscriber: SubscriberDispatchDefinition<EventType>): void {
    if (!this.foldProjections.has(foldName)) {
      throw new ConfigurationError(
        "ProjectionRegistry",
        `Cannot register subscriber "${subscriber.name}" on fold "${foldName}" — fold not registered`,
        { foldName, subscriberName: subscriber.name },
      );
    }
    if (this.subscribers.has(subscriber.name)) {
      throw new ConfigurationError(
        "ProjectionRegistry",
        `Subscriber "${subscriber.name}" already registered`,
        { subscriberName: subscriber.name },
      );
    }
    if (this.mapSubscriberEntries.has(subscriber.name)) {
      throw new ConfigurationError(
        "ProjectionRegistry",
        `Subscriber "${subscriber.name}" already registered`,
        { subscriberName: subscriber.name },
      );
    }
    this.subscribers.set(subscriber.name, { foldName, definition: subscriber });
  }

  registerMapSubscriber(
    mapName: string,
    subscriber: SubscriberDispatchDefinition<EventType>,
  ): void {
    if (!this.mapProjections.has(mapName)) {
      throw new ConfigurationError(
        "ProjectionRegistry",
        `Cannot register subscriber "${subscriber.name}" on map "${mapName}" — map not registered`,
        { mapName, subscriberName: subscriber.name },
      );
    }
    if (this.subscribers.has(subscriber.name)) {
      throw new ConfigurationError(
        "ProjectionRegistry",
        `Map subscriber "${subscriber.name}" already registered`,
        { subscriberName: subscriber.name },
      );
    }
    if (this.mapSubscriberEntries.has(subscriber.name)) {
      throw new ConfigurationError(
        "ProjectionRegistry",
        `Map subscriber "${subscriber.name}" already registered`,
        { subscriberName: subscriber.name },
      );
    }
    this.mapSubscriberEntries.set(subscriber.name, {
      mapName,
      definition: subscriber,
    });
  }

  /**
   * Initialize queue infrastructure. Call after registering projections.
   */
  initialize(
    globalQueue: EventSourcedQueueProcessor<Record<string, unknown>>,
    globalJobRegistry: Map<string, JobRegistryEntry>,
    executionTarget?: ExecutionTarget,
  ): void {
    if (this.queueManager) {
      throw new ConfigurationError(
        "ProjectionRegistry",
        "Already initialized. Call close() before re-initializing.",
      );
    }

    const aggregateType: AggregateType = "global";
    this.queueManager = new QueueManager<EventType>({
      aggregateType,
      pipelineName: "global",
      globalQueue,
      globalJobRegistry,
      parseEvent: this.parseEvent,
    });

    // Create router — all projections are incremental
    const router = new ProjectionRouter<EventType>({
      aggregateType,
      pipelineName: "global",
      queueManager: this.queueManager,
      executionTarget,
    });
    this.router = router;

    for (const { open } of this.foldProjections.values()) {
      open((definition) => router.registerFoldProjection(definition));
    }

    for (const { open } of this.mapProjections.values()) {
      open((definition) => router.registerMapProjection(definition));
    }

    for (const { foldName, definition } of this.subscribers.values()) {
      this.router.registerSubscriber(foldName, definition);
    }

    for (const { mapName, definition } of this.mapSubscriberEntries.values()) {
      this.router.registerMapSubscriber(mapName, definition);
    }

    for (const subscriber of this.eventSubscribers.values()) {
      this.router.registerEventSubscriber(subscriber);
    }

    if (this.foldProjections.size > 0) {
      this.router.initializeFoldQueues();
    }

    if (this.mapProjections.size > 0) {
      this.router.initializeMapQueues();
    }

    if (this.subscribers.size > 0 || this.mapSubscriberEntries.size > 0) {
      this.router.initializeProjectionSubscriberQueues();
    }

    this.router.initializeSubscriberQueues();
    this.closed = false;
  }

  get isInitialized(): boolean {
    return this.router !== undefined;
  }

  get hasProjections(): boolean {
    return (
      this.foldProjections.size > 0 ||
      this.mapProjections.size > 0 ||
      this.subscribers.size > 0 ||
      this.mapSubscriberEntries.size > 0 ||
      this.eventSubscribers.size > 0
    );
  }

  /**
   * Dispatch events from any pipeline. Called by EventSourcingService after
   * local dispatch; answers the lanes it could not stage, for re-drive.
   */
  async dispatch(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<FailedHandoff<EventType>[]> {
    if (!this.hasProjections) {
      return [];
    }
    this.startOnFirstUse();
    if (!this.router) {
      // Absent before initialize() or after close(), in prod overwhelmingly
      // the latter (SIGTERM mid-dispatch). Every lane is answered as failed so
      // the caller records it. See specs/observability/retryable-failure-log-level.feature.
      this.logger.error(
        { eventCount: events.length },
        "ProjectionRegistry has no router (not initialized, or already closed); its lanes are answered for re-drive",
      );
      return this.everyLaneFailed(events);
    }
    return this.router.dispatch(events, context);
  }

  /** Re-stages one recorded event onto one lane; throws while the registry cannot route. */
  async redeliver(params: {
    kind: HandoffLaneKind;
    lane: string;
    event: EventType;
  }): Promise<void> {
    this.startOnFirstUse();
    if (!this.router) {
      throw new DispatchError({
        message: "ProjectionRegistry has no router (not initialized, or already closed)",
        retryable: true,
      });
    }
    await this.router.redeliver(params);
  }

  /** Never after close(): a dispatch racing shutdown is answered for re-drive instead. */
  private startOnFirstUse(): void {
    if (!this.router && !this.closed) this.start?.();
  }

  /** The registry's own lanes, each with the events it takes, as failed hand-offs. */
  private everyLaneFailed(events: readonly EventType[]): FailedHandoff<EventType>[] {
    const error = new Error(
      "ProjectionRegistry has no router (not initialized, or already closed)",
    );
    const lanes = [
      ...[...this.foldProjections].map(([lane, { definition }]) => ({
        kind: "fold" as const,
        lane,
        eventTypes: definition.eventTypes,
      })),
      ...[...this.mapProjections].map(([lane, { definition }]) => ({
        kind: "map" as const,
        lane,
        eventTypes: definition.eventTypes,
      })),
      ...[...this.eventSubscribers].map(([lane, { eventTypes }]) => ({
        kind: "subscriber" as const,
        lane,
        eventTypes,
      })),
    ];
    return lanes.flatMap(({ kind, lane, eventTypes }) => {
      const taken = events.filter(
        (event) => eventTypes.length === 0 || eventTypes.includes(event.type),
      );
      return taken.length > 0 ? [{ kind, lane, events: taken, error }] : [];
    });
  }

  /**
   * Release the router, after which any further dispatch drops its events.
   * The ORDER this is called in is load-bearing: it must come after the queue
   * that feeds it has stopped. See `specs/background/worker-graceful-shutdown.feature`.
   */
  async close(): Promise<void> {
    await this.queueManager?.close();
    this.queueManager = undefined;
    this.router = undefined;
    this.closed = true;
  }

  async waitUntilReady(): Promise<void> {
    await this.queueManager?.waitUntilReady();
  }
}
