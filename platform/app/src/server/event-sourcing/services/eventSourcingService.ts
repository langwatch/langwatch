import { performance } from "node:perf_hooks";
import { createLogger } from "@langwatch/observability";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer, type LangWatchSpan } from "langwatch";
import { leanForProjection } from "~/server/app-layer/traces/lean-for-projection";
import type { FeatureFlagServiceInterface } from "~/server/featureFlag";
import {
  eventSourcingStoreDurationHistogram,
  getEventSourcingEventsStoredCounter,
} from "~/server/metrics";
import type { AggregateType } from "../domain/aggregateType";
import { createTenantId } from "../domain/tenantId";
import type { Event, Projection } from "../domain/types";
import type { FoldProjectionDefinition } from "../projections/foldProjection.types";
import type { ProjectionRegistry } from "../projections/projectionRegistry";
import { ProjectionRouter } from "../projections/projectionRouter";
import type {
  DeduplicationConfig,
  EventSourcedQueueProcessor,
} from "../queues";
import type {
  EventStore,
  EventStoreReadContext,
} from "../stores/eventStore.types";
import { EventUtils } from "../utils/event.utils";
import type {
  EventSourcingOptions,
  EventSourcingServiceOptions,
} from "./eventSourcingService.types";
import { QueueManager } from "./queues/queueManager";

/**
 * Builds the auto-wired `eventLoader` for a fold projection that doesn't
 * already provide one: fetches an aggregate's events from the event store,
 * sorted by occurredAt ASC.
 */
function createEventLoader<EventType extends Event>({
  aggregateType,
  eventStore,
}: {
  aggregateType: AggregateType;
  eventStore: EventStore<EventType>;
}) {
  return async (ctx: {
    tenantId: string;
    aggregateId: string;
    occurredAtMs?: number;
  }) => {
    const events = await eventStore.getEvents({
      aggregateId: ctx.aggregateId,
      context: { tenantId: createTenantId(ctx.tenantId) },
      aggregateType,
      anchorOccurredAtMs: ctx.occurredAtMs,
    });
    return [...events].sort(
      (a, b) => (a.occurredAt ?? 0) - (b.occurredAt ?? 0),
    );
  };
}

/**
 * Builds the auto-wired `eventLoaderUpTo` shared by fold and map projections:
 * history up to AND including the delivered event in log order, so a
 * store-miss re-fold can never pre-apply an event that is persisted but still
 * queued for this projection (per-aggregate FIFO delivers it next).
 */
function createEventLoaderUpTo<EventType extends Event>({
  aggregateType,
  eventStore,
}: {
  aggregateType: AggregateType;
  eventStore: EventStore<EventType>;
}) {
  return async (ctx: {
    tenantId: string;
    aggregateId: string;
    upToEvent: Event;
  }) => {
    const events = await eventStore.getEventsUpTo({
      aggregateId: ctx.aggregateId,
      context: { tenantId: createTenantId(ctx.tenantId) },
      aggregateType,
      upToEvent: ctx.upToEvent as EventType,
    });
    return [...events].sort(
      (a, b) => (a.occurredAt ?? 0) - (b.occurredAt ?? 0),
    );
  };
}

/**
 * Builds the auto-wired `eventLoaderUpToPaged` for a fold projection: one
 * (timestamp, eventId)-ordered page of history up to AND including the
 * delivered event — the executor pages through it so a huge aggregate's
 * history never lands in memory whole. No occurredAt re-sort: the streaming
 * path is used only for order-insensitive folds, where page order is
 * immaterial.
 */
function createEventLoaderUpToPaged<EventType extends Event>({
  aggregateType,
  eventStore,
}: {
  aggregateType: AggregateType;
  eventStore: EventStore<EventType>;
}) {
  return async (ctx: {
    tenantId: string;
    aggregateId: string;
    upToEvent: Event;
    after: { timestamp: number; eventId: string } | undefined;
    limit: number;
  }) => {
    const events = await eventStore.getEventsUpToPaged!({
      aggregateId: ctx.aggregateId,
      context: { tenantId: createTenantId(ctx.tenantId) },
      aggregateType,
      upToEvent: ctx.upToEvent as EventType,
      after: ctx.after,
      limit: ctx.limit,
    });
    return [...events];
  };
}

/**
 * Enriches each event with the current processing traceparent when it
 * doesn't already carry one (for debugging). Events whose metadata is
 * unchanged are returned as the same reference; the traceparent is
 * pre-fetched once for the whole batch.
 */
function enrichEventsWithTraceContext<EventType extends Event>(
  events: readonly EventType[],
): EventType[] {
  const currentTraceparent = EventUtils.getCurrentTraceparentFromActiveSpan();
  return events.map((event) => {
    const enrichedMetadata =
      EventUtils.buildEventMetadataWithCurrentProcessingTraceparent(
        event.metadata,
        currentTraceparent,
      );
    if (enrichedMetadata === event.metadata) {
      return event;
    }
    const hasMetadata =
      enrichedMetadata &&
      Object.keys(enrichedMetadata as Record<string, unknown>).length > 0;
    if (!hasMetadata) {
      return event;
    }
    return {
      ...event,
      metadata: enrichedMetadata,
    };
  });
}

/**
 * Extracts a loggable summary of an AggregateError's sub-errors (first three
 * stack lines each), or an empty array when `error` isn't an AggregateError.
 */
function extractAggregateSubErrors(
  error: unknown,
): Array<{ message: string; stack?: string } | string> {
  if (!(error instanceof AggregateError)) {
    return [];
  }
  return error.errors.map((e: unknown) =>
    e instanceof Error
      ? {
          message: e.message,
          stack: e.stack?.split("\n").slice(0, 3).join("\n"),
        }
      : String(e),
  );
}

/**
 * Main service that orchestrates event sourcing.
 * Coordinates between event stores, projection stores, and event handlers.
 *
 * Uses ProjectionRouter for unified dispatch to both FoldProjections and MapProjections.
 */
export class EventSourcingService<
  EventType extends Event = Event,
  ProjectionTypes extends Record<string, Projection> = Record<
    string,
    Projection
  >,
> {
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.event-sourcing-service",
  );
  private readonly logger: ReturnType<typeof createLogger>;

  private readonly pipelineName: string;
  private readonly aggregateType: AggregateType;
  private readonly eventStore: EventStore<EventType>;
  private readonly options: EventSourcingOptions<EventType>;
  private readonly queueManager: QueueManager<EventType>;
  private readonly router: ProjectionRouter<EventType, ProjectionTypes>;
  private readonly featureFlagService?: FeatureFlagServiceInterface;
  private readonly globalRegistry?: ProjectionRegistry<Event>;

  constructor({
    pipelineName,
    aggregateType,
    eventStore,
    foldProjections,
    stateProjections,
    mapProjections,
    reactors,
    mapReactors,
    subscribers,
    serviceOptions,
    logger,
    globalQueue,
    globalJobRegistry,
    featureFlagService,
    commandRegistrations,
    globalRegistry,
    processRole,
    replayMarkerChecker,
    retentionPolicyResolver,
  }: EventSourcingServiceOptions<EventType, ProjectionTypes>) {
    this.pipelineName = pipelineName;
    this.aggregateType = aggregateType;
    this.eventStore = eventStore;
    this.options = serviceOptions ?? {};
    this.logger =
      logger ??
      createLogger("langwatch.trace-processing.event-sourcing-service");
    this.featureFlagService = featureFlagService;
    this.globalRegistry = globalRegistry;

    this.warnIfMissingGlobalQueueInProduction({
      aggregateType,
      globalQueue,
      foldProjections,
      stateProjections,
      mapProjections,
      subscribers,
    });

    this.queueManager = new QueueManager<EventType>({
      aggregateType,
      pipelineName: this.pipelineName,
      globalQueue,
      globalJobRegistry,
      featureFlagService: this.featureFlagService,
    });

    // Create ProjectionRouter (no event store needed — incremental only)
    this.router = new ProjectionRouter<EventType, ProjectionTypes>({
      aggregateType,
      pipelineName,
      queueManager: this.queueManager,
      featureFlagService,
      processRole,
      replayMarkerChecker,
      retentionPolicyResolver,
    });

    this.registerFoldProjections({
      foldProjections,
      eventStore,
      aggregateType,
    });
    this.registerStateProjections(stateProjections);
    this.registerMapProjections({ mapProjections, eventStore, aggregateType });
    this.registerReactors(reactors);
    this.registerMapReactors(mapReactors);
    this.registerEventSubscribers(subscribers);

    this.initializeQueues({
      globalQueue,
      foldProjections,
      stateProjections,
      mapProjections,
      reactors,
      mapReactors,
      subscribers,
      commandRegistrations,
      pipelineName,
    });
  }

  /**
   * Warns (at construction) when this pipeline registers projections or
   * subscribers but has no global queue in production — those would run
   * synchronously inline rather than through the queue.
   */
  private warnIfMissingGlobalQueueInProduction({
    aggregateType,
    globalQueue,
    foldProjections,
    stateProjections,
    mapProjections,
    subscribers,
  }: {
    aggregateType: AggregateType;
    globalQueue: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["globalQueue"];
    foldProjections: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["foldProjections"];
    stateProjections: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["stateProjections"];
    mapProjections: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["mapProjections"];
    subscribers: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["subscribers"];
  }): void {
    if (
      process.env.NODE_ENV === "production" &&
      !globalQueue &&
      ((foldProjections && foldProjections.length > 0) ||
        (stateProjections && stateProjections.length > 0) ||
        (mapProjections && mapProjections.length > 0) ||
        (subscribers && subscribers.length > 0))
    ) {
      this.logger.warn(
        { aggregateType },
        "[PERFORMANCE] EventSourcingService initialized without global queue in production. Projections will be executed synchronously.",
      );
    }
  }

  /**
   * Registers fold projections and auto-wires event loaders for
   * out-of-order re-fold, in the original per-fold order.
   */
  private registerFoldProjections({
    foldProjections,
    eventStore,
    aggregateType,
  }: {
    foldProjections: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["foldProjections"];
    eventStore: EventStore<EventType>;
    aggregateType: AggregateType;
  }): void {
    if (!foldProjections) {
      return;
    }

    for (const fold of foldProjections) {
      this.wireFoldProjectionLoaders({ fold, eventStore, aggregateType });
      this.router.registerFoldProjection(fold);
    }
  }

  /**
   * Auto-wires a single fold projection's event loaders (eventLoader,
   * eventLoaderUpTo, and — when the store supports paginated reads —
   * eventLoaderUpToPaged), skipping any the projection already provides.
   */
  private wireFoldProjectionLoaders({
    fold,
    eventStore,
    aggregateType,
  }: {
    fold: FoldProjectionDefinition<any, EventType>;
    eventStore: EventStore<EventType>;
    aggregateType: AggregateType;
  }): void {
    // If the projection doesn't already have an eventLoader, provide one
    // that fetches events from the event store sorted by occurredAt.
    if (!fold.eventLoader && eventStore) {
      fold.eventLoader = createEventLoader({ aggregateType, eventStore });
    }
    // Companion loader for refoldOnStoreMiss: history up to AND including
    // the delivered event in log order, so a store-miss re-fold can never
    // pre-apply an event that is persisted but still queued for this
    // projection (per-aggregate FIFO delivers it next).
    if (!fold.eventLoaderUpTo && eventStore) {
      fold.eventLoaderUpTo = createEventLoaderUpTo({
        aggregateType,
        eventStore,
      });
    }
    // Paginated companion loader for the store-miss re-fold streaming path.
    // Returns one (timestamp, eventId)-ordered page — the executor pages
    // through it so a huge aggregate's history never lands in memory whole.
    // No occurredAt re-sort: the streaming path is used only for
    // order-insensitive folds, where page order is immaterial.
    if (
      !fold.eventLoaderUpToPaged &&
      eventStore &&
      eventStore.getEventsUpToPaged
    ) {
      fold.eventLoaderUpToPaged = createEventLoaderUpToPaged({
        aggregateType,
        eventStore,
      });
    }
  }

  /**
   * Registers default state projections. They deliberately receive no
   * event-log loaders — their injected repository is read directly under the
   * queue's key lock.
   */
  private registerStateProjections(
    stateProjections: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["stateProjections"],
  ): void {
    if (!stateProjections) {
      return;
    }

    for (const projection of stateProjections) {
      this.router.registerStateProjection(projection);
    }
  }

  /**
   * Registers map projections, auto-wiring the log-ordered history loader
   * for `options.dedupeByIdempotencyKey` — same shape as the fold
   * projections' eventLoaderUpTo.
   */
  private registerMapProjections({
    mapProjections,
    eventStore,
    aggregateType,
  }: {
    mapProjections: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["mapProjections"];
    eventStore: EventStore<EventType>;
    aggregateType: AggregateType;
  }): void {
    if (!mapProjections) {
      return;
    }

    for (const mapProj of mapProjections) {
      if (!mapProj.eventLoaderUpTo && eventStore) {
        mapProj.eventLoaderUpTo = createEventLoaderUpTo({
          aggregateType,
          eventStore,
        });
      }
      this.router.registerMapProjection(mapProj);
    }
  }

  /** Registers reactors on their fold projections. */
  private registerReactors(
    reactors: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["reactors"],
  ): void {
    if (!reactors) {
      return;
    }

    for (const { foldName, definition } of reactors) {
      this.router.registerReactor(foldName, definition);
    }
  }

  /** Registers reactors on their map projections. */
  private registerMapReactors(
    mapReactors: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["mapReactors"],
  ): void {
    if (!mapReactors) {
      return;
    }

    for (const { mapName, definition } of mapReactors) {
      this.router.registerMapReactor(mapName, definition);
    }
  }

  /** Registers live event-only subscribers, independent of projection state. */
  private registerEventSubscribers(
    subscribers: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["subscribers"],
  ): void {
    if (!subscribers) {
      return;
    }

    for (const subscriber of subscribers) {
      this.router.registerEventSubscriber(subscriber);
    }
  }

  /**
   * Initializes queue consumers for every registered entry. All processes
   * register all entries — the shared pipeline queue's Worker must know
   * every job type so it can dispatch any job it picks up. Command queues
   * always initialize — they're needed for dispatching.
   */
  private initializeQueues({
    globalQueue,
    foldProjections,
    stateProjections,
    mapProjections,
    reactors,
    mapReactors,
    subscribers,
    commandRegistrations,
    pipelineName,
  }: {
    globalQueue: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["globalQueue"];
    foldProjections: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["foldProjections"];
    stateProjections: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["stateProjections"];
    mapProjections: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["mapProjections"];
    reactors: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["reactors"];
    mapReactors: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["mapReactors"];
    subscribers: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["subscribers"];
    commandRegistrations: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["commandRegistrations"];
    pipelineName: string;
  }): void {
    this.initializeProjectionQueues({
      globalQueue,
      foldProjections,
      stateProjections,
      mapProjections,
      subscribers,
    });
    this.initializeReactorQueuesIfNeeded({
      globalQueue,
      reactors,
      mapReactors,
    });
    this.initializeCommandQueuesIfNeeded({
      globalQueue,
      commandRegistrations,
      pipelineName,
    });
  }

  /** Starts the map/fold/state/subscriber queue consumers that have any registrations. */
  private initializeProjectionQueues({
    globalQueue,
    foldProjections,
    stateProjections,
    mapProjections,
    subscribers,
  }: {
    globalQueue: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["globalQueue"];
    foldProjections: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["foldProjections"];
    stateProjections: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["stateProjections"];
    mapProjections: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["mapProjections"];
    subscribers: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["subscribers"];
  }): void {
    if (globalQueue && mapProjections && mapProjections.length > 0) {
      this.router.initializeMapQueues();
    }

    if (globalQueue && foldProjections && foldProjections.length > 0) {
      this.router.initializeFoldQueues();
    }

    if (globalQueue && stateProjections && stateProjections.length > 0) {
      this.router.initializeStateProjectionQueues();
    }

    if (globalQueue && subscribers && subscribers.length > 0) {
      this.router.initializeSubscriberQueues();
    }
  }

  /** Starts the reactor queue consumer when any fold or map reactors are registered. */
  private initializeReactorQueuesIfNeeded({
    globalQueue,
    reactors,
    mapReactors,
  }: {
    globalQueue: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["globalQueue"];
    reactors: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["reactors"];
    mapReactors: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["mapReactors"];
  }): void {
    if (
      globalQueue &&
      ((reactors && reactors.length > 0) ||
        (mapReactors && mapReactors.length > 0))
    ) {
      this.router.initializeReactorQueues();
    }
  }

  /** Initializes command queues — always, since dispatching depends on them. */
  private initializeCommandQueuesIfNeeded({
    globalQueue,
    commandRegistrations,
    pipelineName,
  }: {
    globalQueue: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["globalQueue"];
    commandRegistrations: EventSourcingServiceOptions<
      EventType,
      ProjectionTypes
    >["commandRegistrations"];
    pipelineName: string;
  }): void {
    if (
      globalQueue &&
      commandRegistrations &&
      commandRegistrations.length > 0
    ) {
      this.queueManager.initializeCommandQueues(
        commandRegistrations,
        this.storeEvents.bind(this),
        pipelineName,
      );
    }
  }

  /**
   * Stores events using the pipeline's aggregate type.
   *
   * **Execution Flow:**
   * 1. Events are stored in the event store (must succeed)
   * 3. Events are dispatched to all projections via ProjectionRouter - errors are logged but don't fail
   */
  async storeEvents(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    return await this.tracer.withActiveSpan(
      "EventSourcingService.storeEvents",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.type": this.aggregateType,
          "event.count": events.length,
          "tenant.id": context.tenantId,
          "event.types": [...new Set(events.map((e) => e.type))].join(","),
        },
      },
      async (span) => {
        const storeStart = performance.now();
        EventUtils.validateTenantId(context, "storeEvents");

        // Enrich events with trace context if missing (for debugging)
        const enrichedEvents = enrichEventsWithTraceContext(events);

        await this.persistEnrichedEvents({ span, enrichedEvents, context });

        // ADR-022: Derive lean shapes for projection dispatch.
        // storeEvents has already persisted the FULL events to event_log.
        // Map to new array — do NOT mutate enrichedEvents in place.
        const leanedEvents = enrichedEvents.map(
          (e) => leanForProjection(e) as EventType,
        );

        await this.dispatchToProjectionRouter({
          span,
          leanedEvents,
          context,
          enrichedEventCount: enrichedEvents.length,
        });
        await this.dispatchToGlobalRegistry({ span, leanedEvents, context });

        this.recordStoreMetrics({
          eventCount: enrichedEvents.length,
          storeStart,
        });
      },
    );
  }

  /** Persists the enriched events to the event store, bracketed by span events. */
  private async persistEnrichedEvents({
    span,
    enrichedEvents,
    context,
  }: {
    span: LangWatchSpan;
    enrichedEvents: EventType[];
    context: EventStoreReadContext<EventType>;
  }): Promise<void> {
    span.addEvent("event_store.store.start");
    await this.eventStore.storeEvents(
      enrichedEvents,
      context,
      this.aggregateType,
    );
    span.addEvent("event_store.store.complete");
  }

  /**
   * Dispatches events to all projections (fold + map) via the unified
   * router, when any are registered. Dispatch errors are logged but don't
   * fail `storeEvents` — the events are already durable.
   */
  private async dispatchToProjectionRouter({
    span,
    leanedEvents,
    context,
    enrichedEventCount,
  }: {
    span: LangWatchSpan;
    leanedEvents: EventType[];
    context: EventStoreReadContext<EventType>;
    enrichedEventCount: number;
  }): Promise<void> {
    const hasAnyProjection =
      this.router.hasFoldProjections ||
      this.router.hasStateProjections ||
      this.router.hasMapProjections ||
      this.router.hasEventSubscribers;
    if (!(leanedEvents.length > 0 && hasAnyProjection)) {
      return;
    }

    span.addEvent("projection.dispatch.start");
    try {
      await this.router.dispatch(leanedEvents, context);
      span.addEvent("projection.dispatch.complete");
    } catch (error) {
      span.addEvent("projection.dispatch.error", {
        "error.message": error instanceof Error ? error.message : String(error),
      });
      this.logProjectionDispatchFailure({ error, enrichedEventCount });
    }
  }

  /** Logs a router dispatch failure (best-effort — events are already durable). */
  private logProjectionDispatchFailure({
    error,
    enrichedEventCount,
  }: {
    error: unknown;
    enrichedEventCount: number;
  }): void {
    if (!this.logger) {
      return;
    }
    this.logger.error(
      {
        aggregateType: this.aggregateType,
        eventCount: enrichedEventCount,
        error: error instanceof Error ? error.message : String(error),
        subErrors: extractAggregateSubErrors(error),
      },
      "Failed to dispatch events to projections",
    );
  }

  /**
   * Dispatches events to the global (cross-pipeline) projection registry,
   * when one is configured. Dispatch errors are logged but don't fail
   * `storeEvents` — the events are already durable.
   */
  private async dispatchToGlobalRegistry({
    span,
    leanedEvents,
    context,
  }: {
    span: LangWatchSpan;
    leanedEvents: EventType[];
    context: EventStoreReadContext<EventType>;
  }): Promise<void> {
    if (!(this.globalRegistry && leanedEvents.length > 0)) {
      return;
    }

    span.addEvent("global_projection.dispatch.start");
    try {
      await this.globalRegistry.dispatch(leanedEvents, context);
      span.addEvent("global_projection.dispatch.complete");
    } catch (error) {
      span.addEvent("global_projection.dispatch.error", {
        "error.message": error instanceof Error ? error.message : String(error),
      });
      this.logger.error(
        {
          aggregateType: this.aggregateType,
          eventCount: leanedEvents.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to dispatch events to global projection registry",
      );
    }
  }

  /** Records throughput and duration metrics for a `storeEvents` call. */
  private recordStoreMetrics({
    eventCount,
    storeStart,
  }: {
    eventCount: number;
    storeStart: number;
  }): void {
    getEventSourcingEventsStoredCounter(this.pipelineName).inc(eventCount);
    eventSourcingStoreDurationHistogram
      .labels(this.pipelineName)
      .observe(performance.now() - storeStart);
  }

  /**
   * Gets a specific fold projection by name for a given aggregate.
   */
  async getProjectionByName<
    ProjectionName extends keyof ProjectionTypes & string,
  >({
    projectionName,
    aggregateId,
    context,
    options,
  }: {
    projectionName: ProjectionName;
    aggregateId: string;
    context: EventStoreReadContext<EventType>;
    options?: { key?: string };
  }): Promise<ProjectionTypes[ProjectionName] | null> {
    return this.router.getProjectionByName({
      projectionName,
      aggregateId,
      context,
      options,
    });
  }

  /**
   * Checks if a specific fold projection exists for a given aggregate.
   */
  async hasProjectionByName<
    ProjectionName extends keyof ProjectionTypes & string,
  >({
    projectionName,
    aggregateId,
    context,
    options,
  }: {
    projectionName: ProjectionName;
    aggregateId: string;
    context: EventStoreReadContext<EventType>;
    options?: { key?: string };
  }): Promise<boolean> {
    return await this.router.hasProjectionByName({
      projectionName,
      aggregateId,
      context,
      options,
    });
  }

  /**
   * Gets the list of available projection names.
   */
  getProjectionNames(): string[] {
    return this.router.getProjectionNames();
  }

  /**
   * Gets the command queue dispatchers created during initialization.
   */
  getCommandQueues(): Map<string, EventSourcedQueueProcessor<any>> {
    return this.queueManager.getCommandQueues();
  }

  /**
   * Registers a standalone job in the global queue.
   *
   * Returns `null` when the global queue is not available (event sourcing disabled).
   */
  registerJob<P extends Record<string, unknown>>(config: {
    name: string;
    process: (payload: P) => Promise<void>;
    delay?: number;
    deduplication?: DeduplicationConfig<P>;
    groupKeyFn?: (payload: P) => string;
    scoreFn?: (payload: P) => number;
    spanAttributes?: (payload: P) => Record<string, string | number | boolean>;
  }): EventSourcedQueueProcessor<P> | null {
    return this.queueManager.registerJob<P>(config);
  }

  /**
   * Gracefully closes all queue processors.
   */
  async close(): Promise<void> {
    await this.queueManager.close();
  }

  /**
   * Waits for all queue processors to be ready to accept jobs.
   */
  async waitUntilReady(): Promise<void> {
    await this.queueManager.waitUntilReady();
  }
}
