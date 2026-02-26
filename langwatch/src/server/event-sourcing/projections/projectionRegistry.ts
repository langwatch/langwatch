import type { ProcessRole } from "../../app-layer/config";
import { createLogger } from "~/utils/logger/server";
import type { AggregateType } from "../domain/aggregateType";
import type { Event } from "../domain/types";
import type { EventSourcedQueueProcessor } from "../queues";
import type { ReactorDefinition } from "../reactors/reactor.types";
import { ConfigurationError } from "../services/errorHandling";
import { QueueManager, type JobRegistryEntry } from "../services/queues/queueManager";
import type { EventStoreReadContext } from "../stores/eventStore.types";
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
  private readonly foldProjections = new Map<string, FoldProjectionDefinition<any, EventType>>();
  private readonly mapProjections = new Map<string, MapProjectionDefinition<any, EventType>>();
  private readonly reactors = new Map<string, { foldName: string; definition: ReactorDefinition<EventType> }>();
  private router?: ProjectionRouter<EventType>;
  private queueManager?: QueueManager<EventType>;

  registerFoldProjection(projection: FoldProjectionDefinition<any, EventType>): void {
    if (this.foldProjections.has(projection.name)) {
      throw new ConfigurationError(
        "ProjectionRegistry",
        `Fold projection "${projection.name}" already registered`,
        { projectionName: projection.name },
      );
    }
    this.foldProjections.set(projection.name, projection);
  }

  registerMapProjection(projection: MapProjectionDefinition<any, EventType>): void {
    if (this.mapProjections.has(projection.name)) {
      throw new ConfigurationError(
        "ProjectionRegistry",
        `Map projection "${projection.name}" already registered`,
        { projectionName: projection.name },
      );
    }
    this.mapProjections.set(projection.name, projection);
  }

  registerReactor(foldName: string, reactor: ReactorDefinition<EventType>): void {
    if (!this.foldProjections.has(foldName)) {
      throw new ConfigurationError(
        "ProjectionRegistry",
        `Cannot register reactor "${reactor.name}" on fold "${foldName}" — fold not registered`,
        { foldName, reactorName: reactor.name },
      );
    }
    if (this.reactors.has(reactor.name)) {
      throw new ConfigurationError(
        "ProjectionRegistry",
        `Reactor "${reactor.name}" already registered`,
        { reactorName: reactor.name },
      );
    }
    this.reactors.set(reactor.name, { foldName, definition: reactor });
  }

  /**
   * Initialize queue infrastructure. Call after registering projections.
   */
  initialize(
    globalQueue: EventSourcedQueueProcessor<Record<string, unknown>>,
    globalJobRegistry: Map<string, JobRegistryEntry>,
    processRole?: ProcessRole,
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
      pipelineName: "global_projections",
      globalQueue,
      globalJobRegistry,
    });

    // Create router — all projections are incremental
    this.router = new ProjectionRouter<EventType>(
      aggregateType,
      "global_projections",
      this.queueManager,
      undefined, // featureFlagService
      processRole,
    );

    for (const fold of this.foldProjections.values()) {
      this.router.registerFoldProjection(fold);
    }

    for (const mapProj of this.mapProjections.values()) {
      this.router.registerMapProjection(mapProj);
    }

    for (const { foldName, definition } of this.reactors.values()) {
      this.router.registerReactor(foldName, definition);
    }

    if (this.foldProjections.size > 0) {
      this.router.initializeFoldQueues();
    }

    if (this.mapProjections.size > 0) {
      this.router.initializeMapQueues();
    }

    if (this.reactors.size > 0) {
      this.router.initializeReactorQueues();
    }
  }

  get isInitialized(): boolean {
    return this.router !== undefined;
  }

  get hasProjections(): boolean {
    return this.foldProjections.size > 0 || this.mapProjections.size > 0 || this.reactors.size > 0;
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
      this.logger.warn(
        "ProjectionRegistry.dispatch called before initialize(). Events will be dropped.",
      );
      return;
    }
    await this.router.dispatch(events, context);
  }

  async close(): Promise<void> {
    await this.queueManager?.close();
    this.queueManager = undefined;
    this.router = undefined;
  }

  async waitUntilReady(): Promise<void> {
    await this.queueManager?.waitUntilReady();
  }
}
