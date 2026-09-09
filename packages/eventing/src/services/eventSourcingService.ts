import { performance } from "node:perf_hooks";
import { createLogger } from "@langwatch/observability";
import { type Span, SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { AggregateType } from "../domain/aggregateType.ts";
import { createTenantId } from "../domain/tenantId.ts";
import type { Event, Projection } from "../domain/types.ts";
import type { ProjectionRegistry } from "../projections/projectionRegistry.ts";
import { ProjectionRouter } from "../projections/projectionRouter.ts";
import type { DeduplicationConfig, EventSourcedQueueProcessor } from "../queues/index.ts";
import type { EventStore, EventStoreReadContext } from "../stores/eventStore.types.ts";
import { EventUtils } from "../utils/event.utils.ts";
import type {
  EventSourcingOptions,
  EventSourcingServiceOptions,
} from "./eventSourcingService.types.ts";
import { QueueManager } from "./queues/queueManager.ts";

/** Flattens an AggregateError's members into loggable `{message, stack}` shapes. */
function extractSubErrors(error: unknown): Array<{ message: string; stack?: string } | string> {
  if (!(error instanceof AggregateError)) return [];
  return error.errors.map((e: unknown) =>
    e instanceof Error
      ? { message: e.message, stack: e.stack?.split("\n").slice(0, 3).join("\n") }
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
  ProjectionTypes extends Record<string, Projection> = Record<string, Projection>,
> {
  private readonly tracer = getLangWatchTracer("langwatch.trace-processing.event-sourcing-service");
  private readonly logger: ReturnType<typeof createLogger>;

  private readonly pipelineName: string;
  private readonly aggregateType: AggregateType;
  private readonly allowedEventTypes: ReadonlySet<string>;
  private readonly eventStore: EventStore<EventType>;
  private readonly options: EventSourcingOptions<EventType>;
  private readonly queueManager: QueueManager<EventType>;
  private readonly router: ProjectionRouter<EventType, ProjectionTypes>;
  private readonly globalRegistry?: ProjectionRegistry<Event>;
  private readonly prepareEventForProjection: (event: EventType) => EventType;
  private readonly metrics?: EventSourcingServiceOptions<EventType, ProjectionTypes>["metrics"];

  constructor({
    pipelineName,
    aggregateType,
    allowedEventTypes,
    eventStore,
    foldProjections,
    stateProjections,
    mapProjections,
    foldSubscribers,
    mapSubscribers,
    subscribers,
    serviceOptions,
    logger,
    globalQueue,
    globalJobRegistry,
    prepareEventForProjection,
    metrics,
    commandRegistrations,
    globalRegistry,
    executionTarget,
    replayMarkerChecker,
    retentionPolicyResolver,
    killSwitch,
    warnWhenProjectionsRunInline = false,
  }: EventSourcingServiceOptions<EventType, ProjectionTypes>) {
    this.pipelineName = pipelineName;
    this.aggregateType = aggregateType;
    this.allowedEventTypes = new Set(allowedEventTypes);
    this.eventStore = eventStore;
    this.options = serviceOptions ?? {};
    this.logger = logger ?? createLogger("langwatch.trace-processing.event-sourcing-service");
    this.globalRegistry = globalRegistry;
    this.prepareEventForProjection = prepareEventForProjection ?? ((event) => event);
    this.metrics = metrics;

    // Process composition opts into this production-safety warning. Eventing
    // deliberately does not inspect the host environment itself.
    this.warnIfProjectionsRunInline({
      warnWhenProjectionsRunInline,
      globalQueue,
      aggregateType,
      foldProjections,
      stateProjections,
      mapProjections,
      foldSubscribers,
      mapSubscribers,
      subscribers,
    });

    this.queueManager = new QueueManager<EventType>({
      aggregateType,
      pipelineName: this.pipelineName,
      globalQueue,
      globalJobRegistry,
      killSwitch,
    });

    // Create ProjectionRouter (no event store needed — incremental only)
    this.router = new ProjectionRouter<EventType, ProjectionTypes>(
      aggregateType,
      pipelineName,
      this.queueManager,
      { executionTarget, replayMarkerChecker, retentionPolicyResolver, killSwitch },
    );

    this.registerFoldProjections(foldProjections, aggregateType, eventStore);
    this.registerStateProjections(stateProjections);
    this.registerMapProjections(mapProjections, aggregateType, eventStore);
    this.registerSubscribers({ foldSubscribers, mapSubscribers, subscribers });
    this.initializeRouterQueues({
      globalQueue,
      mapProjections,
      foldProjections,
      stateProjections,
      subscribers,
      foldSubscribers,
      mapSubscribers,
    });

    // Command queues always initialize — they're needed for dispatching
    if (globalQueue && commandRegistrations && commandRegistrations.length > 0) {
      this.queueManager.initializeCommandQueues(
        commandRegistrations,
        this.storeEvents.bind(this),
        pipelineName,
      );
    }
  }

  /**
   * Logs the production-safety warning when projection work exists but no
   * global queue was supplied — everything would then run synchronously.
   * Extracted so the condition it tests stays a named, glanceable boolean.
   */
  private warnIfProjectionsRunInline(
    params: Pick<
      EventSourcingServiceOptions<EventType, ProjectionTypes>,
      | "warnWhenProjectionsRunInline"
      | "globalQueue"
      | "aggregateType"
      | "foldProjections"
      | "stateProjections"
      | "mapProjections"
      | "foldSubscribers"
      | "mapSubscribers"
      | "subscribers"
    >,
  ): void {
    const {
      warnWhenProjectionsRunInline,
      globalQueue,
      aggregateType,
      foldProjections,
      stateProjections,
      mapProjections,
      foldSubscribers,
      mapSubscribers,
      subscribers,
    } = params;
    const hasInlineWork =
      (foldProjections && foldProjections.length > 0) ||
      (stateProjections && stateProjections.length > 0) ||
      (mapProjections && mapProjections.length > 0) ||
      (foldSubscribers && foldSubscribers.length > 0) ||
      (mapSubscribers && mapSubscribers.length > 0) ||
      (subscribers && subscribers.length > 0);
    if (warnWhenProjectionsRunInline && !globalQueue && hasInlineWork) {
      this.logger.warn(
        { aggregateType },
        "[PERFORMANCE] EventSourcingService initialized without global queue in production. Projections will be executed synchronously.",
      );
    }
  }

  /** Registers fold projections, auto-wiring event loaders for out-of-order re-fold. */
  private registerFoldProjections(
    foldProjections: EventSourcingServiceOptions<EventType, ProjectionTypes>["foldProjections"],
    aggregateType: AggregateType,
    eventStore: EventStore<EventType>,
  ): void {
    if (!foldProjections) return;
    for (const fold of foldProjections) {
      // If the projection doesn't already have an eventLoader, provide one
      // that fetches events from the event store sorted by occurredAt.
      if (!fold.eventLoader && eventStore) {
        const capturedAggregateType = aggregateType;
        const capturedEventStore = eventStore;
        fold.eventLoader = async (ctx: {
          tenantId: string;
          aggregateId: string;
          occurredAtMs?: number;
        }) => {
          const events = await capturedEventStore.getEvents(
            ctx.aggregateId,
            { tenantId: createTenantId(ctx.tenantId) },
            capturedAggregateType,
            ctx.occurredAtMs,
          );
          return [...events].sort((a, b) => (a.occurredAt ?? 0) - (b.occurredAt ?? 0));
        };
      }
      // Companion loader for refoldOnStoreMiss: history up to AND including
      // the delivered event in log order, so a store-miss re-fold can never
      // pre-apply an event that is persisted but still queued for this
      // projection (per-aggregate FIFO delivers it next).
      if (!fold.eventLoaderUpTo && eventStore) {
        const capturedAggregateType = aggregateType;
        const capturedEventStore = eventStore;
        fold.eventLoaderUpTo = async (ctx: {
          tenantId: string;
          aggregateId: string;
          upToEvent: Event;
        }) => {
          const events = await capturedEventStore.getEventsUpTo(
            ctx.aggregateId,
            { tenantId: createTenantId(ctx.tenantId) },
            capturedAggregateType,
            ctx.upToEvent as EventType,
          );
          return [...events].sort((a, b) => (a.occurredAt ?? 0) - (b.occurredAt ?? 0));
        };
      }
      // Paginated companion loader for the store-miss re-fold streaming path.
      // Returns one (timestamp, eventId)-ordered page — the executor pages
      // through it so a huge aggregate's history never lands in memory whole.
      // No occurredAt re-sort: the streaming path is used only for
      // order-insensitive folds, where page order is immaterial.
      if (!fold.eventLoaderUpToPaged && eventStore && eventStore.getEventsUpToPaged) {
        const capturedAggregateType = aggregateType;
        const capturedEventStore = eventStore;
        fold.eventLoaderUpToPaged = async (ctx: {
          tenantId: string;
          aggregateId: string;
          upToEvent: Event;
          after: { timestamp: number; eventId: string } | undefined;
          limit: number;
        }) => {
          const events = await capturedEventStore.getEventsUpToPaged!({
            aggregateId: ctx.aggregateId,
            context: { tenantId: createTenantId(ctx.tenantId) },
            aggregateType: capturedAggregateType,
            upToEvent: ctx.upToEvent as EventType,
            after: ctx.after,
            limit: ctx.limit,
          });
          return [...events];
        };
      }
      this.router.registerFoldProjection(fold);
    }
  }

  // Default state projections deliberately receive no event-log loaders.
  // Their injected repository is read directly under the queue's key lock.
  private registerStateProjections(
    stateProjections: EventSourcingServiceOptions<EventType, ProjectionTypes>["stateProjections"],
  ): void {
    if (!stateProjections) return;
    for (const projection of stateProjections) {
      this.router.registerStateProjection(projection);
    }
  }

  /** Registers map projections, auto-wiring the dedupe history loader. */
  private registerMapProjections(
    mapProjections: EventSourcingServiceOptions<EventType, ProjectionTypes>["mapProjections"],
    aggregateType: AggregateType,
    eventStore: EventStore<EventType>,
  ): void {
    if (!mapProjections) return;
    for (const mapProj of mapProjections) {
      // Auto-wire the log-ordered history loader for
      // `options.dedupeByIdempotencyKey` — same shape as the fold
      // projections' eventLoaderUpTo.
      if (!mapProj.eventLoaderUpTo && eventStore) {
        const capturedAggregateType = aggregateType;
        const capturedEventStore = eventStore;
        mapProj.eventLoaderUpTo = async (ctx: {
          tenantId: string;
          aggregateId: string;
          upToEvent: Event;
        }) => {
          const events = await capturedEventStore.getEventsUpTo(
            ctx.aggregateId,
            { tenantId: createTenantId(ctx.tenantId) },
            capturedAggregateType,
            ctx.upToEvent as EventType,
          );
          return [...events].sort((a, b) => (a.occurredAt ?? 0) - (b.occurredAt ?? 0));
        };
      }
      this.router.registerMapProjection(mapProj);
    }
  }

  /** Registers fold/map/event subscribers on their respective projections. */
  private registerSubscribers(
    params: Pick<
      EventSourcingServiceOptions<EventType, ProjectionTypes>,
      "foldSubscribers" | "mapSubscribers" | "subscribers"
    >,
  ): void {
    const { foldSubscribers, mapSubscribers, subscribers } = params;
    if (foldSubscribers) {
      for (const { foldName, definition } of foldSubscribers) {
        this.router.registerSubscriber(foldName, definition);
      }
    }
    if (mapSubscribers) {
      for (const { mapName, definition } of mapSubscribers) {
        this.router.registerMapSubscriber(mapName, definition);
      }
    }
    if (subscribers) {
      for (const subscriber of subscribers) {
        this.router.registerEventSubscriber(subscriber);
      }
    }
  }

  /**
   * All processes register all entries — the shared pipeline queue's Worker
   * must know every job type so it can dispatch any job it picks up.
   */
  private initializeRouterQueues(
    params: Pick<
      EventSourcingServiceOptions<EventType, ProjectionTypes>,
      | "globalQueue"
      | "mapProjections"
      | "foldProjections"
      | "stateProjections"
      | "subscribers"
      | "foldSubscribers"
      | "mapSubscribers"
    >,
  ): void {
    const {
      globalQueue,
      mapProjections,
      foldProjections,
      stateProjections,
      subscribers,
      foldSubscribers,
      mapSubscribers,
    } = params;
    if (!globalQueue) return;

    if (mapProjections && mapProjections.length > 0) {
      this.router.initializeMapQueues();
    }
    if (foldProjections && foldProjections.length > 0) {
      this.router.initializeFoldQueues();
    }
    if (stateProjections && stateProjections.length > 0) {
      this.router.initializeStateProjectionQueues();
    }
    if (subscribers && subscribers.length > 0) {
      this.router.initializeSubscriberQueues();
    }
    const hasProjectionSubscribers =
      (foldSubscribers && foldSubscribers.length > 0) ||
      (mapSubscribers && mapSubscribers.length > 0);
    if (hasProjectionSubscribers) {
      this.router.initializeProjectionSubscriberQueues();
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
      (span) => this.storeEventsWithinSpan(events, context, span),
    );
  }

  /** The body of `storeEvents`'s active span: validate, enrich, persist, then dispatch. */
  private async storeEventsWithinSpan(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
    span: Span,
  ): Promise<void> {
    const storeStart = performance.now();
    EventUtils.validateTenantId(context, "storeEvents");
    this.assertEventsBelongToPipeline(events);

    // Pre-fetch traceparent once for the batch
    const currentTraceparent = EventUtils.getCurrentTraceparentFromActiveSpan();

    // Enrich events with trace context if missing (for debugging)
    const enrichedEvents: EventType[] = events.map((event) =>
      this.enrichEventWithTraceparent(event, currentTraceparent),
    );

    span.addEvent("event_store.store.start");
    await this.eventStore.storeEvents(enrichedEvents, context, this.aggregateType);
    span.addEvent("event_store.store.complete");

    // ADR-022: Derive lean shapes for projection dispatch.
    // storeEvents has already persisted the FULL events to event_log.
    // Map to new array — do NOT mutate enrichedEvents in place.
    const leanedEvents = enrichedEvents.map((event) => this.prepareEventForProjection(event));

    await this.dispatchToRouter({ leanedEvents, enrichedEvents, context, span });
    await this.dispatchToGlobalRegistry({ leanedEvents, context, span });

    // Record throughput and duration metrics
    this.metrics?.eventsStored(this.pipelineName, enrichedEvents.length);
    this.metrics?.storeDuration(this.pipelineName, performance.now() - storeStart);
  }

  /** Throws if any event was mis-routed to this pipeline. */
  private assertEventsBelongToPipeline(events: readonly EventType[]): void {
    for (const event of events) {
      if (event.aggregateType !== this.aggregateType) {
        throw new Error(
          `Pipeline "${this.pipelineName}" owns aggregate "${this.aggregateType}" but received "${event.aggregateType}"`,
        );
      }
      if (!this.allowedEventTypes.has(event.type)) {
        throw new Error(
          `Pipeline "${this.pipelineName}" received unregistered event type "${event.type}"`,
        );
      }
    }
  }

  /** Adds current-processing traceparent metadata to an event, if missing. */
  private enrichEventWithTraceparent(
    event: EventType,
    currentTraceparent: string | undefined,
  ): EventType {
    const enrichedMetadata = EventUtils.buildEventMetadataWithCurrentProcessingTraceparent(
      event.metadata,
      currentTraceparent,
    );
    if (enrichedMetadata === event.metadata) {
      return event;
    }
    const hasMetadata =
      enrichedMetadata && Object.keys(enrichedMetadata as Record<string, unknown>).length > 0;
    if (!hasMetadata) {
      return event;
    }
    return {
      ...event,
      metadata: enrichedMetadata,
    };
  }

  /** Dispatches leaned events to the fold/map/subscriber router, tolerating and logging failure. */
  private async dispatchToRouter({
    leanedEvents,
    enrichedEvents,
    context,
    span,
  }: {
    leanedEvents: EventType[];
    enrichedEvents: EventType[];
    context: EventStoreReadContext<EventType>;
    span: Span;
  }): Promise<void> {
    const hasProjectionWork =
      this.router.hasFoldProjections ||
      this.router.hasStateProjections ||
      this.router.hasMapProjections ||
      this.router.hasEventSubscribers;
    if (leanedEvents.length === 0 || !hasProjectionWork) return;

    span.addEvent("projection.dispatch.start");
    try {
      await this.router.dispatch(leanedEvents, context);
      span.addEvent("projection.dispatch.complete");
    } catch (error) {
      span.addEvent("projection.dispatch.error", {
        "error.message": error instanceof Error ? error.message : String(error),
      });
      if (this.logger) {
        const subErrors = extractSubErrors(error);
        this.logger.error(
          {
            aggregateType: this.aggregateType,
            eventCount: enrichedEvents.length,
            error: error instanceof Error ? error.message : String(error),
            subErrors,
          },
          "Failed to dispatch events to projections",
        );
      }
    }
  }

  /** Dispatches leaned events to the cross-pipeline global registry, logging any failure. */
  private async dispatchToGlobalRegistry({
    leanedEvents,
    context,
    span,
  }: {
    leanedEvents: EventType[];
    context: EventStoreReadContext<EventType>;
    span: Span;
  }): Promise<void> {
    if (!this.globalRegistry || leanedEvents.length === 0) return;

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

  /**
   * Gets a specific fold projection by name for a given aggregate.
   */
  async getProjectionByName<ProjectionName extends keyof ProjectionTypes & string>(
    projectionName: ProjectionName,
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    options?: { key?: string },
  ): Promise<ProjectionTypes[ProjectionName] | null> {
    return this.router.getProjectionByName(projectionName, aggregateId, context, options);
  }

  /**
   * Checks if a specific fold projection exists for a given aggregate.
   */
  async hasProjectionByName<ProjectionName extends keyof ProjectionTypes & string>(
    projectionName: ProjectionName,
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    options?: { key?: string },
  ): Promise<boolean> {
    return await this.router.hasProjectionByName(projectionName, aggregateId, context, options);
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
