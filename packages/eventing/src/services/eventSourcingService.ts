import { performance } from "node:perf_hooks";

import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import { context as otelContext, propagation, type Span, SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type { AggregateType } from "../domain/aggregateType.ts";
import { createTenantId } from "../domain/tenantId.ts";
import type { Event, Projection } from "../domain/types.ts";
import { incrementEsHandoffTotal } from "../metrics.ts";
import type { DispatchableMessage } from "../process-manager/outbox/outboxDispatcherService.ts";
import type {
  NewOutboxMessage,
  ProcessStore,
} from "../process-manager/stores/processStore.types.ts";
import type { ProjectionRegistry } from "../projections/projectionRegistry.ts";
import { ProjectionRouter } from "../projections/projectionRouter.ts";
import { DispatchError } from "../queues/dispatchError.ts";
import type { DeduplicationConfig, EventSourcedQueueProcessor } from "../queues/index.ts";
import type { EventStore, EventStoreReadContext } from "../stores/eventStore.types.ts";
import { EventUtils } from "../utils/event.utils.ts";
import type {
  EventSourcingOptions,
  EventSourcingServiceOptions,
} from "./eventSourcingService.types.ts";
import {
  type FailedHandoff,
  HANDOFF_PROCESS_NAME,
  handoffLaneKindSchema,
  handoffMessageKey,
  type HandoffPayload,
  handoffPayloadSchema,
  type HandoffScope,
} from "./handoff/failedHandoff.ts";
import { QueueManager } from "./queues/queueManager.ts";

/** A failed lane, tagged with the dispatcher that answered it. */
type ScopedFailure<E extends Event> = FailedHandoff<E> & { scope: HandoffScope };

/**
 * Main service that orchestrates event sourcing: coordinates event stores,
 * projection stores, and event handlers, using ProjectionRouter for unified
 * dispatch to both FoldProjections and MapProjections.
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
  private readonly handoffStore?: ProcessStore;
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
    handoffStore,
    executionTarget,
    replayMarkerChecker,
    retentionPolicyResolver,
    killSwitch,
    parseEvent,
    warnWhenProjectionsRunInline = false,
  }: EventSourcingServiceOptions<EventType, ProjectionTypes>) {
    this.pipelineName = pipelineName;
    this.aggregateType = aggregateType;
    this.allowedEventTypes = new Set(allowedEventTypes);
    this.eventStore = eventStore;
    this.options = serviceOptions ?? {};
    this.logger = logger ?? createLogger("langwatch.trace-processing.event-sourcing-service");
    this.globalRegistry = globalRegistry;
    this.handoffStore = handoffStore;
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
      parseEvent,
    });

    // Create ProjectionRouter (no event store needed — incremental only)
    this.router = new ProjectionRouter<EventType, ProjectionTypes>({
      aggregateType,
      pipelineName,
      queueManager: this.queueManager,
      executionTarget,
      replayMarkerChecker,
      retentionPolicyResolver,
      killSwitch,
    });

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
    for (const { definition: fold, open } of foldProjections) {
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
          const events = await capturedEventStore.getEvents({
            aggregateId: ctx.aggregateId,
            context: { tenantId: createTenantId(ctx.tenantId) },
            aggregateType: capturedAggregateType,
            anchorOccurredAtMs: ctx.occurredAtMs,
          });
          return [...events].toSorted((a, b) => (a.occurredAt ?? 0) - (b.occurredAt ?? 0));
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
          const events = await capturedEventStore.getEventsUpTo({
            aggregateId: ctx.aggregateId,
            context: { tenantId: createTenantId(ctx.tenantId) },
            aggregateType: capturedAggregateType,
            upToEvent: ctx.upToEvent as EventType,
          });
          return [...events].toSorted((a, b) => (a.occurredAt ?? 0) - (b.occurredAt ?? 0));
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
      open((definition) => this.router.registerFoldProjection(definition));
    }
  }

  // Default state projections deliberately receive no event-log loaders.
  // Their injected repository is read directly under the queue's key lock.
  private registerStateProjections(
    stateProjections: EventSourcingServiceOptions<EventType, ProjectionTypes>["stateProjections"],
  ): void {
    if (!stateProjections) return;
    for (const { open } of stateProjections) {
      open((definition) => this.router.registerStateProjection(definition));
    }
  }

  /** Registers map projections, auto-wiring the dedupe history loader. */
  private registerMapProjections(
    mapProjections: EventSourcingServiceOptions<EventType, ProjectionTypes>["mapProjections"],
    aggregateType: AggregateType,
    eventStore: EventStore<EventType>,
  ): void {
    if (!mapProjections) return;
    for (const { definition: mapProj, open } of mapProjections) {
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
          const events = await capturedEventStore.getEventsUpTo({
            aggregateId: ctx.aggregateId,
            context: { tenantId: createTenantId(ctx.tenantId) },
            aggregateType: capturedAggregateType,
            upToEvent: ctx.upToEvent as EventType,
          });
          return [...events].toSorted((a, b) => (a.occurredAt ?? 0) - (b.occurredAt ?? 0));
        };
      }
      open((definition) => this.router.registerMapProjection(definition));
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
   * Stores events using the pipeline's aggregate type. Events are stored in
   * the event store first (must succeed), then staged onto their lanes; a lane
   * that fails is recorded in the hand-off outbox and never fails the store.
   */
  async storeEvents(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    return this.tracer.withActiveSpan(
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

    const failures = [
      ...(await this.dispatchToRouter({ leanedEvents, context, span })),
      ...(await this.dispatchToGlobalRegistry({ leanedEvents, context, span })),
    ];
    await this.recordFailedHandoffs({ failures, context });

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

  /** Stages leaned events onto the pipeline's own lanes, answering those that failed. */
  private async dispatchToRouter({
    leanedEvents,
    context,
    span,
  }: {
    leanedEvents: EventType[];
    context: EventStoreReadContext<EventType>;
    span: Span;
  }): Promise<ScopedFailure<EventType>[]> {
    const hasProjectionWork =
      this.router.hasFoldProjections ||
      this.router.hasStateProjections ||
      this.router.hasMapProjections ||
      this.router.hasEventSubscribers;
    if (leanedEvents.length === 0 || !hasProjectionWork) return [];

    span.addEvent("projection.dispatch.start");
    const failures = await this.router.dispatch(leanedEvents, context);
    span.addEvent("projection.dispatch.complete", { "handoff.failed": failures.length });
    return failures.map((failure) => ({ ...failure, scope: "pipeline" }));
  }

  /** Stages leaned events onto the cross-pipeline global registry, answering failed lanes. */
  private async dispatchToGlobalRegistry({
    leanedEvents,
    context,
    span,
  }: {
    leanedEvents: EventType[];
    context: EventStoreReadContext<EventType>;
    span: Span;
  }): Promise<ScopedFailure<EventType>[]> {
    if (!this.globalRegistry || leanedEvents.length === 0) return [];

    span.addEvent("global_projection.dispatch.start");
    const failures = await this.globalRegistry.dispatch(leanedEvents, context);
    span.addEvent("global_projection.dispatch.complete", { "handoff.failed": failures.length });
    const leanedById = new Map(leanedEvents.map((event) => [event.id, event]));
    return failures.map((failure) => ({
      kind: failure.kind,
      lane: failure.lane,
      events: failure.events.flatMap((event) => leanedById.get(event.id) ?? []),
      error: failure.error,
      scope: "global",
    }));
  }

  /**
   * Records one outbox row per failed (lane, event), so the hand-off outbox
   * re-drives it. Only a failed outbox write, or no outbox, still loses it.
   */
  private async recordFailedHandoffs({
    failures,
    context,
  }: {
    failures: ScopedFailure<EventType>[];
    context: EventStoreReadContext<EventType>;
  }): Promise<void> {
    if (failures.length === 0) return;
    const traceCarrier: Record<string, string> = {};
    propagation.inject(otelContext.active(), traceCarrier);

    const byAggregate = new Map<
      string,
      { failure: ScopedFailure<EventType>; message: NewOutboxMessage }[]
    >();
    for (const failure of failures) {
      for (const event of failure.events) {
        const payload: HandoffPayload = {
          pipeline: this.pipelineName,
          scope: failure.scope,
          lane: failure.lane,
          eventId: event.id,
          aggregateId: String(event.aggregateId),
        };
        const rows = byAggregate.get(payload.aggregateId) ?? [];
        rows.push({
          failure,
          message: {
            messageKey: handoffMessageKey({ kind: failure.kind, payload }),
            intentType: failure.kind,
            payload,
            traceCarrier,
          },
        });
        byAggregate.set(payload.aggregateId, rows);
      }
    }

    for (const [aggregateId, rows] of byAggregate) {
      const outcome = await this.appendHandoffRows({ aggregateId, rows, context });
      for (const { failure } of rows) {
        incrementEsHandoffTotal({
          pipelineName: this.pipelineName,
          laneKind: failure.kind,
          outcome,
        });
      }
    }
  }

  /** One aggregate's rows in one idempotent append; answers whether they landed. */
  private async appendHandoffRows({
    aggregateId,
    rows,
    context,
  }: {
    aggregateId: string;
    rows: { failure: ScopedFailure<EventType>; message: NewOutboxMessage }[];
    context: EventStoreReadContext<EventType>;
  }): Promise<"recorded" | "unrecorded"> {
    const lanes = rows.map(({ failure, message }) => ({
      scope: failure.scope,
      kind: failure.kind,
      lane: failure.lane,
      messageKey: message.messageKey,
      error: failure.error.message,
    }));
    try {
      if (!this.handoffStore) throw new Error("No process store is wired to record hand-offs");
      await this.handoffStore.appendIntents({
        ref: {
          processName: HANDOFF_PROCESS_NAME,
          projectId: context.tenantId,
          processKey: `${this.pipelineName}:${aggregateId}`,
        },
        tenantId: context.tenantId,
        sourceEventId: null,
        messages: rows.map(({ message }) => message),
        now: nowInstant().epochMilliseconds,
      });
      this.logger.warn(
        { pipelineName: this.pipelineName, aggregateId, lanes },
        "Lanes failed to stage; recorded in the hand-off outbox for re-drive",
      );
      return "recorded";
    } catch (error) {
      this.logger.error(
        {
          pipelineName: this.pipelineName,
          aggregateId,
          lanes,
          error: error instanceof Error ? error.message : String(error),
        },
        "Lanes failed to stage and the hand-off outbox could not record them; these reactions are lost",
      );
      return "unrecorded";
    }
  }

  /**
   * Re-stages one recorded hand-off: reads the event back from the event log
   * and stages it onto the one lane that missed it. A throw leaves the row
   * to the outbox's backoff and dead letters.
   */
  async redeliverHandoff({ message }: { message: DispatchableMessage }): Promise<void> {
    const kind = handoffLaneKindSchema.parse(message.intentType);
    const { scope, lane, eventId, aggregateId } = handoffPayloadSchema.parse(message.payload);
    const event = this.prepareEventForProjection(
      await this.eventStore.getEvent({
        eventId,
        tenantId: createTenantId(message.tenantId),
        aggregateType: this.aggregateType,
        aggregateId,
      }),
    );
    if (scope === "pipeline") {
      await this.router.redeliver({ kind, lane, event });
    } else if (this.globalRegistry) {
      await this.globalRegistry.redeliver({ kind, lane, event });
    } else {
      throw new DispatchError({
        message: `Pipeline "${this.pipelineName}" has no global registry to re-drive lane "${lane}"`,
        retryable: false,
      });
    }
    incrementEsHandoffTotal({
      pipelineName: this.pipelineName,
      laneKind: kind,
      outcome: "redriven",
    });
  }

  /**
   * Gets a specific fold projection by name for a given aggregate.
   */
  async getProjectionByName<ProjectionName extends keyof ProjectionTypes & string>({
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
    return this.router.getProjectionByName({ projectionName, aggregateId, context, options });
  }

  /**
   * Checks if a specific fold projection exists for a given aggregate.
   */
  async hasProjectionByName<ProjectionName extends keyof ProjectionTypes & string>({
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
    return this.router.hasProjectionByName({ projectionName, aggregateId, context, options });
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
  getCommandQueues(): Map<string, EventSourcedQueueProcessor<Record<string, unknown>>> {
    return this.queueManager.getCommandQueues();
  }

  /**
   * Registers a standalone job in the global queue.
   *
   * Returns `null` when the global queue is not available (event sourcing disabled).
   */
  registerJob<P extends Record<string, unknown>>(config: {
    name: string;
    parse: (payload: unknown) => P;
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
