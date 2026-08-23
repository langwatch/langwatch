import { createLogger } from "@langwatch/observability";
import type { AggregateType } from "../domain/aggregateType";
import type { Event } from "../domain/types";
import type { EventSourcedQueueProcessor } from "../queues";
import type { ExecutionTarget } from "../runtime.types";
import { ConfigurationError } from "../services/errorHandling";
import {
  type JobRegistryEntry,
  QueueManager,
} from "../services/queues/queueManager";
import type { EventStoreReadContext } from "../stores/eventStore.types";
import type { SubscriberDispatchDefinition } from "../subscribers/subscriber.types";
import type { FoldProjectionDefinition } from "./foldProjection.types";
import type { MapProjectionDefinition } from "./mapProjection.types";
import { ProjectionRouter } from "./projectionRouter";

/**
 * Global projection registry for projections that subscribe to events from multiple pipelines.
 *
 * Key constraints:
 * - Map projections work as-is (stateless, per-event).
 * - No event store — purely incremental, processes live events only.
 */
export class ProjectionRegistry<EventType extends Event = Event> {
  private readonly logger = createLogger(
    "langwatch:event-sourcing:projection-registry",
  );
  private readonly foldProjections = new Map<
    string,
    FoldProjectionDefinition<any, EventType>
  >();
  private readonly mapProjections = new Map<
    string,
    MapProjectionDefinition<any, EventType>
  >();
  private readonly subscribers = new Map<
    string,
    { foldName: string; definition: SubscriberDispatchDefinition<EventType> }
  >();
  private readonly mapSubscriberEntries = new Map<
    string,
    { mapName: string; definition: SubscriberDispatchDefinition<EventType> }
  >();
  private router?: ProjectionRouter<EventType>;
  private queueManager?: QueueManager<EventType>;

  registerFoldProjection(
    projection: FoldProjectionDefinition<any, EventType>,
  ): void {
    if (this.foldProjections.has(projection.name)) {
      throw new ConfigurationError(
        "ProjectionRegistry",
        `Fold projection "${projection.name}" already registered`,
        { projectionName: projection.name },
      );
    }
    this.foldProjections.set(projection.name, projection);
  }

  registerMapProjection(
    projection: MapProjectionDefinition<any, EventType>,
  ): void {
    if (this.mapProjections.has(projection.name)) {
      throw new ConfigurationError(
        "ProjectionRegistry",
        `Map projection "${projection.name}" already registered`,
        { projectionName: projection.name },
      );
    }
    this.mapProjections.set(projection.name, projection);
  }

  registerSubscriber(
    foldName: string,
    subscriber: SubscriberDispatchDefinition<EventType>,
  ): void {
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
    });

    // Create router — all projections are incremental
    this.router = new ProjectionRouter<EventType>(
      aggregateType,
      "global",
      this.queueManager,
      { executionTarget },
    );

    for (const fold of this.foldProjections.values()) {
      this.router.registerFoldProjection(fold);
    }

    for (const mapProj of this.mapProjections.values()) {
      this.router.registerMapProjection(mapProj);
    }

    for (const { foldName, definition } of this.subscribers.values()) {
      this.router.registerSubscriber(foldName, definition);
    }

    for (const { mapName, definition } of this.mapSubscriberEntries.values()) {
      this.router.registerMapSubscriber(mapName, definition);
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
  }

  get isInitialized(): boolean {
    return this.router !== undefined;
  }

  get hasProjections(): boolean {
    return (
      this.foldProjections.size > 0 ||
      this.mapProjections.size > 0 ||
      this.subscribers.size > 0 ||
      this.mapSubscriberEntries.size > 0
    );
  }

  /**
   * Dispatch events from any pipeline. Called by EventSourcingService after local dispatch.
   */
  async dispatch(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    if (!this.hasProjections) {
      return;
    }
    if (!this.router) {
      // Error, not warning: nothing is thrown and nothing retries, so this is
      // the last layer that can report the loss. The router is absent either
      // before initialize() or after close() — in prod it is overwhelmingly
      // the latter, dispatches still in flight when SIGTERM lands. Naming only
      // the first case sent five days of shutdown drops looking for a boot
      // race. See specs/observability/retryable-failure-log-level.feature.
      this.logger.error(
        { eventCount: events.length },
        "ProjectionRegistry has no router (not initialized, or already closed); events dropped",
      );
      return;
    }
    await this.router.dispatch(events, context);
  }

  /**
   * Release the router, after which any further dispatch drops its events.
   *
   * That makes the ORDER this is called in load-bearing: it must come after the
   * queue that feeds it has stopped, or jobs still draining will dispatch into
   * a closed registry. See `EventSourcing.close()` and
   * `specs/background/worker-graceful-shutdown.feature`.
   */
  async close(): Promise<void> {
    await this.queueManager?.close();
    this.queueManager = undefined;
    this.router = undefined;
  }

  async waitUntilReady(): Promise<void> {
    await this.queueManager?.waitUntilReady();
  }
}
