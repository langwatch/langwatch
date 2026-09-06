import { createLogger } from "@langwatch/observability";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import {
  incrementEsFoldPostStoreFailure,
  incrementEsFoldProjectionTotal,
  incrementEsMapProjectionEnqueueTotal,
  incrementEsMapProjectionTotal,
  incrementEsProjectionTotal,
  incrementEsReactorCollapsedTotal,
  incrementEsReactorTotal,
  incrementEsSubscriberEnqueueTotal,
  incrementEsSubscriberTotal,
  observeEsFoldProjectionDuration,
  observeEsMapProjectionDuration,
  observeEsProjectionDuration,
  observeEsReactorDuration,
  observeEsSubscriberDuration,
  withMetrics,
} from "../metrics";
import type { AggregateType } from "../domain/aggregateType";
import type { Event, Projection } from "../domain/types";
import type { DeduplicationStrategy } from "../queues";
import { ConfigurationError, categorizeError, handleError } from "../services/errorHandling";
import type { QueueManager } from "../services/queues/queueManager";
import type { EventStoreReadContext } from "../stores/eventStore.types";
import { TIME_LOCAL_AGGREGATE_TYPES } from "../stores/rehydrationWindow";
import type { EventSubscriberDefinition } from "../subscribers/eventSubscriber.types";
import type { SubscriberDispatchDefinition } from "../subscribers/subscriber.types";
import { isComponentKilled, type KillSwitchPort } from "../kill-switch";
import { EventUtils } from "../utils/event.utils";
import { toError } from "../utils/errors";
import {
  executionTargetMatches,
  type ExecutionTarget,
  type RetentionPolicy,
  type RetentionPolicyResolver,
} from "../runtime.types";
import { MAX_APPLIED_EVENT_IDS } from "./foldCache/foldCacheEntry";
import type { FoldProjectionDefinition } from "./foldProjection.types";
import { FoldProjectionExecutor } from "./foldProjectionExecutor";
import type { MapProjectionDefinition } from "./mapProjection.types";
import { MapProjectionExecutor } from "./mapProjectionExecutor";
import type { ProjectionStoreContext } from "./projectionStoreContext";
import type { ReplayMarkerChecker } from "./replayMarkerCheck";
import type { StateProjectionDefinition } from "./stateProjection.types";
import { StateProjectionExecutor } from "./stateProjectionExecutor";

/**
 * Default cap on same-aggregate fold events coalesced into one cycle — a pure
 * left-fold, so raising this changes throughput only, never correctness.
 * Opt out via options.coalesceMaxBatch = 1.
 */
export const DEFAULT_FOLD_COALESCE_MAX_BATCH = 500;
const SLOW_PROJECTION_OPERATION_MS = 5_000;

/**
 * Caps event ids in a post-store-failure log line — a coalesced batch can
 * hold up to DEFAULT_FOLD_COALESCE_MAX_BATCH. `eventCount` reports true size.
 */
const MAX_LOGGED_EVENT_IDS = 10;

/**
 * The router only dispatches subscribers on the live event path — the replay
 * service never invokes them. Named so `SubscriberDispatchContext.isReplay`
 * reads as "always false here" rather than a forgotten TODO.
 */
const LIVE_DISPATCH_IS_REPLAY = false;

/**
 * One event paired with the state a subscriber should see for it — lets fold
 * (same state per batch) and map (distinct record per event) dispatch through
 * one path.
 */
type SubscriberDelivery<E extends Event> = { event: E; foldState: unknown };

/**
 * Registers fold and map projections and dispatches events. Folds enqueue to
 * GroupQueue (per-aggregate ordering); maps enqueue to SimpleQueue (per-event).
 */
export class ProjectionRouter<
  EventType extends Event = Event,
  ProjectionTypes extends Record<string, Projection> = Record<string, Projection>,
> {
  private readonly executionTarget?: ExecutionTarget;
  private readonly replayMarkerChecker?: ReplayMarkerChecker;
  private readonly retentionPolicyResolver?: RetentionPolicyResolver;
  private readonly killSwitch?: KillSwitchPort;
  private readonly tracer = getLangWatchTracer("langwatch.event-sourcing.projection-router");
  private readonly logger = createLogger("langwatch:event-sourcing:projection-router");
  private readonly foldExecutor = new FoldProjectionExecutor();
  private readonly stateProjectionExecutor = new StateProjectionExecutor();
  private readonly mapExecutor = new MapProjectionExecutor();

  private readonly foldProjections = new Map<string, FoldProjectionDefinition<any, EventType>>();
  private readonly stateProjections = new Map<string, StateProjectionDefinition<any, EventType>>();
  private readonly mapProjections = new Map<string, MapProjectionDefinition<any, EventType>>();
  private readonly subscribersForFold = new Map<
    string,
    SubscriberDispatchDefinition<EventType>[]
  >();
  private readonly subscribersForMap = new Map<string, SubscriberDispatchDefinition<EventType>[]>();
  private readonly eventSubscribers = new Map<string, EventSubscriberDefinition<EventType>>();

  constructor(
    private readonly aggregateType: AggregateType,
    private readonly pipelineName: string,
    private readonly queueManager: QueueManager<EventType>,
    options: {
      executionTarget?: ExecutionTarget;
      replayMarkerChecker?: ReplayMarkerChecker;
      retentionPolicyResolver?: RetentionPolicyResolver;
      killSwitch?: KillSwitchPort;
    } = {},
  ) {
    this.executionTarget = options.executionTarget;
    this.replayMarkerChecker = options.replayMarkerChecker;
    this.retentionPolicyResolver = options.retentionPolicyResolver;
    this.killSwitch = options.killSwitch;
  }

  registerFoldProjection(projection: FoldProjectionDefinition<any, EventType>): void {
    if (this.foldProjections.has(projection.name)) {
      throw new ConfigurationError(
        "ProjectionRouter",
        `Fold projection with name "${projection.name}" already registered`,
        { projectionName: projection.name },
      );
    }
    this.assertCoalesceWithinAppliedIdCap(projection);
    this.assertTrustedAbsenceIsTimeLocal(projection);
    this.foldProjections.set(projection.name, projection);
  }

  /**
   * `trustAbsentMiss` treats an absent windowed read as proof nothing was
   * committed — only true for aggregate types whose rows never outlive the window.
   */
  private assertTrustedAbsenceIsTimeLocal(
    projection: FoldProjectionDefinition<any, EventType>,
  ): void {
    if (projection.options?.trustAbsentMiss !== true) return;
    if (projection.options.readWindow === undefined) return;
    if (TIME_LOCAL_AGGREGATE_TYPES.has(this.aggregateType)) return;

    throw new ConfigurationError(
      "ProjectionRouter",
      `Fold projection "${projection.name}" trusts an absent windowed read but its aggregate type "${this.aggregateType}" is not time-local: rows of such an aggregate outlive any window width, so an absent read is not proof the state was never committed.`,
      {
        projectionName: projection.name,
        aggregateType: this.aggregateType,
      },
    );
  }

  /**
   * A durable-watermark store's Redis cache trims to `MAX_APPLIED_EVENT_IDS`
   * while ClickHouse doesn't — coalescing at or above that cap lets a
   * cache-hit retry double-count ids surviving only in ClickHouse.
   */
  private assertCoalesceWithinAppliedIdCap(
    projection: FoldProjectionDefinition<any, EventType>,
  ): void {
    const hasDurableWatermark =
      typeof (projection.store as { getWithApplied?: unknown }).getWithApplied === "function";
    if (!hasDurableWatermark) return;

    const effectiveBatch = projection.options?.coalesceMaxBatch ?? DEFAULT_FOLD_COALESCE_MAX_BATCH;
    if (effectiveBatch < MAX_APPLIED_EVENT_IDS) return;

    throw new ConfigurationError(
      "ProjectionRouter",
      `Fold projection "${projection.name}" coalesces up to ${effectiveBatch} events but the applied-id cap is ${MAX_APPLIED_EVENT_IDS}: a coalesced batch larger than the applied-id cap breaks redelivery dedup for durable-watermark folds.`,
      {
        projectionName: projection.name,
        coalesceMaxBatch: effectiveBatch,
        maxAppliedEventIds: MAX_APPLIED_EVENT_IDS,
      },
    );
  }

  registerStateProjection(projection: StateProjectionDefinition<any, EventType>): void {
    if (this.stateProjections.has(projection.name)) {
      throw new ConfigurationError(
        "ProjectionRouter",
        `Projection with name "${projection.name}" already registered`,
        { projectionName: projection.name },
      );
    }
    this.stateProjections.set(projection.name, projection);
  }

  registerMapProjection(projection: MapProjectionDefinition<any, EventType>): void {
    if (this.mapProjections.has(projection.name)) {
      throw new ConfigurationError(
        "ProjectionRouter",
        `Map projection with name "${projection.name}" already registered`,
        { projectionName: projection.name },
      );
    }
    this.mapProjections.set(projection.name, projection);
  }

  registerSubscriber(foldName: string, subscriber: SubscriberDispatchDefinition<EventType>): void {
    if (!this.foldProjections.has(foldName)) {
      throw new ConfigurationError(
        "ProjectionRouter",
        `Cannot register subscriber "${subscriber.name}" on fold "${foldName}" — fold not found`,
        { foldName, subscriberName: subscriber.name },
      );
    }

    const existing = this.subscribersForFold.get(foldName) ?? [];
    existing.push(subscriber);
    this.subscribersForFold.set(foldName, existing);
  }

  registerMapSubscriber(
    mapName: string,
    subscriber: SubscriberDispatchDefinition<EventType>,
  ): void {
    if (!this.mapProjections.has(mapName)) {
      throw new ConfigurationError(
        "ProjectionRouter",
        `Cannot register subscriber "${subscriber.name}" on map "${mapName}" — map not found`,
        { mapName, subscriberName: subscriber.name },
      );
    }

    const existing = this.subscribersForMap.get(mapName) ?? [];
    existing.push(subscriber);
    this.subscribersForMap.set(mapName, existing);
  }

  registerEventSubscriber(subscriber: EventSubscriberDefinition<EventType>): void {
    if (this.eventSubscribers.has(subscriber.name)) {
      throw new ConfigurationError(
        "ProjectionRouter",
        `Event subscriber "${subscriber.name}" already registered`,
        { subscriberName: subscriber.name },
      );
    }
    this.eventSubscribers.set(subscriber.name, subscriber);
  }

  /** Register queued processors for live event-only subscribers. */
  initializeSubscriberQueues(): void {
    if (this.eventSubscribers.size === 0) return;

    const subscriberDefs: Record<
      string,
      {
        name: string;
        handler: { handle: (event: EventType) => Promise<void> };
        options: {
          eventTypes: readonly string[];
          delay?: number;
          deduplication?: DeduplicationStrategy<EventType>;
          groupKeyFn?: (event: EventType) => string;
          spanAttributes: (event: EventType) => Record<string, string | number | boolean>;
        };
      }
    > = {};

    for (const [name, subscriber] of this.eventSubscribers) {
      subscriberDefs[name] = {
        name,
        handler: {
          handle: (event) => this.handleSubscriber(subscriber, event),
        },
        options: {
          eventTypes: subscriber.eventTypes,
          delay: subscriber.options?.delay,
          deduplication: subscriber.options?.deduplication,
          groupKeyFn: subscriber.options?.groupKeyFn,
          spanAttributes: (event) => ({
            "subscriber.name": name,
            "event.type": event.type,
            "event.id": event.id,
            "event.aggregate_id": String(event.aggregateId),
            "tenant.id": String(event.tenantId),
          }),
        },
      };
    }

    this.queueManager.initializeSubscriberQueues(subscriberDefs, async (subscriberName, event) => {
      const subscriber = this.eventSubscribers.get(subscriberName);
      if (!subscriber) {
        throw new ConfigurationError(
          "ProjectionRouter",
          `Event subscriber "${subscriberName}" not found`,
          { subscriberName },
        );
      }
      await this.handleSubscriber(subscriber, event);
    });
  }

  /**
   * Initialize queue processors for projection subscribers.
   * Each subscriber gets a SimpleQueue for async dispatch.
   */
  initializeProjectionSubscriberQueues(): void {
    if (this.subscribersForFold.size === 0 && this.subscribersForMap.size === 0) return;

    const subscriberDefs: Record<
      string,
      {
        name: string;
        parentProjection: string;
        parentType: "fold" | "map";
        handler: {
          handle: (payload: { event: EventType; foldState: unknown }) => Promise<void>;
        };
        groupKeyFn?: (payload: { event: EventType; foldState: unknown }) => string;
        options?: {
          disabled?: boolean;
          delay?: number;
          deduplication?: DeduplicationStrategy<{
            event: EventType;
            foldState: unknown;
          }>;
        };
      }
    > = {};

    for (const [foldName, subscribers] of this.subscribersForFold) {
      for (const subscriber of subscribers) {
        if (this.isSubscriberExcluded(subscriber)) continue;
        subscriberDefs[subscriber.name] = {
          name: subscriber.name,
          parentProjection: foldName,
          parentType: "fold" as const,
          handler: {
            handle: async (payload: { event: EventType; foldState: unknown }) => {
              await subscriber.handle(payload.event, {
                tenantId: payload.event.tenantId,
                aggregateId: String(payload.event.aggregateId),
                foldState: payload.foldState,
                isReplay: LIVE_DISPATCH_IS_REPLAY,
              });
            },
          },
          groupKeyFn: subscriber.options?.groupKeyFn,
          options: {
            disabled: subscriber.options?.disabled,
            delay: subscriber.options?.delay,
            deduplication:
              subscriber.options?.deduplication ??
              (subscriber.options?.makeJobId
                ? {
                    makeId: subscriber.options.makeJobId,
                    ttlMs: subscriber.options.ttl,
                  }
                : undefined),
          },
        };
      }
    }

    for (const [mapName, subscribers] of this.subscribersForMap) {
      for (const subscriber of subscribers) {
        if (this.isSubscriberExcluded(subscriber)) continue;
        subscriberDefs[subscriber.name] = {
          name: subscriber.name,
          parentProjection: mapName,
          parentType: "map" as const,
          handler: {
            handle: async (payload: { event: EventType; foldState: unknown }) => {
              await subscriber.handle(payload.event, {
                tenantId: payload.event.tenantId,
                aggregateId: String(payload.event.aggregateId),
                foldState: payload.foldState,
                isReplay: LIVE_DISPATCH_IS_REPLAY,
              });
            },
          },
          groupKeyFn: subscriber.options?.groupKeyFn,
          options: {
            disabled: subscriber.options?.disabled,
            delay: subscriber.options?.delay,
            deduplication:
              subscriber.options?.deduplication ??
              (subscriber.options?.makeJobId
                ? {
                    makeId: subscriber.options.makeJobId,
                    ttlMs: subscriber.options.ttl,
                  }
                : undefined),
          },
        };
      }
    }

    this.queueManager.initializeProjectionSubscriberQueues(
      subscriberDefs,
      async (subscriberName, payload, _context) => {
        const subscriberDef = subscriberDefs[subscriberName];
        if (!subscriberDef) {
          throw new ConfigurationError(
            "ProjectionRouter",
            `Subscriber "${subscriberName}" not found`,
            { subscriberName },
          );
        }
        await withMetrics({
          fn: () => subscriberDef.handler.handle(payload),
          onComplete: (ms) => {
            incrementEsReactorTotal(this.pipelineName, subscriberName, "completed");
            observeEsReactorDuration(this.pipelineName, subscriberName, ms);
          },
          onFail: (ms) => {
            incrementEsReactorTotal(this.pipelineName, subscriberName, "failed");
            observeEsReactorDuration(this.pipelineName, subscriberName, ms);
          },
        });
      },
    );
  }

  /**
   * Shares the fold executor's pure load/apply/store mechanics, but never
   * wires history loaders or dispatches subscribers from the resulting state.
   */
  initializeStateProjectionQueues(): void {
    if (this.stateProjections.size === 0) return;

    const projectionDefs: Record<
      string,
      {
        name: string;
        groupKeyFn?: (event: EventType) => string;
        scoreFn?: (event: EventType) => number;
        coalesceMaxBatch?: number;
        options?: { disabled?: boolean };
      }
    > = {};

    for (const [name, projection] of this.stateProjections) {
      projectionDefs[name] = {
        name,
        groupKeyFn: projection.key,
        // Score by createdAt so delivery order agrees with the state
        // executor's (createdAt, id) cursor — otherwise the staleness guard
        // can drop an earlier-appended event still queued behind a later one.
        scoreFn: (event) => event.createdAt,
        coalesceMaxBatch: projection.options?.coalesceMaxBatch ?? 1,
        options: projection.options,
      };
    }

    this.queueManager.initializeStateProjectionQueues(
      projectionDefs,
      async (projectionName, event, context) => {
        const projection = this.stateProjections.get(projectionName);
        if (!projection) {
          throw new ConfigurationError(
            "ProjectionRouter",
            `Projection "${projectionName}" not found`,
            { projectionName },
          );
        }
        await this.processStateProjectionEvents(projectionName, projection, [event], context);
      },
      async (projectionName, events, context) => {
        const projection = this.stateProjections.get(projectionName);
        if (!projection) {
          throw new ConfigurationError(
            "ProjectionRouter",
            `Projection "${projectionName}" not found`,
            { projectionName },
          );
        }
        await this.processStateProjectionEvents(projectionName, projection, events, context);
      },
    );
  }

  /**
   * Initialize queue processors for fold projections.
   * Each fold projection gets a GroupQueue that processes events incrementally.
   */
  initializeFoldQueues(): void {
    if (this.foldProjections.size === 0) return;

    const projectionDefs: Record<
      string,
      {
        name: string;
        groupKeyFn?: (event: EventType) => string;
        scoreFn?: (event: EventType) => number;
        coalesceMaxBatch?: number;
        options?: { disabled?: boolean };
      }
    > = {};

    for (const [name, fold] of this.foldProjections) {
      projectionDefs[name] = {
        name,
        groupKeyFn: fold.key,
        scoreFn:
          fold.options?.eventOrdering === "acceptedAt" ? (event) => event.createdAt : undefined,
        // Coalesces a backed-up group into one load/apply/store cycle — safe
        // since a pure left-fold gives the same result either way, and
        // subscribers still fire per event, just observing the final batch
        // state. Opt out via options.coalesceMaxBatch = 1.
        coalesceMaxBatch: fold.options?.coalesceMaxBatch ?? DEFAULT_FOLD_COALESCE_MAX_BATCH,
        options: fold.options,
      };
    }

    this.queueManager.initializeProjectionQueues(
      projectionDefs,
      async (projectionName, triggerEvent, context) => {
        const fold = this.foldProjections.get(projectionName);
        if (!fold) {
          throw new ConfigurationError(
            "ProjectionRouter",
            `Fold projection "${projectionName}" not found`,
            { projectionName },
          );
        }

        await this.processFoldProjectionEvent(projectionName, fold, triggerEvent, {
          tenantId: triggerEvent.tenantId,
          ...(context.deliveryAttempt !== undefined
            ? { deliveryAttempt: context.deliveryAttempt }
            : {}),
        });
      },
      async (projectionName, events, context) => {
        const fold = this.foldProjections.get(projectionName);
        if (!fold) {
          throw new ConfigurationError(
            "ProjectionRouter",
            `Fold projection "${projectionName}" not found`,
            { projectionName },
          );
        }

        await this.processFoldProjectionBatch(projectionName, fold, events, {
          tenantId: events[0]!.tenantId,
          ...(context.deliveryAttempt !== undefined
            ? { deliveryAttempt: context.deliveryAttempt }
            : {}),
          // A bisected sub-batch after the first commit of its dispatch: the
          // fold commit must extend the applied-id set, not replace it
          // (#6578). Dropping this here silently re-enables the double-apply
          // this chain exists to prevent.
          ...(context.isDeliveryContinuation !== undefined
            ? { isDeliveryContinuation: context.isDeliveryContinuation }
            : {}),
        });
      },
    );
  }

  /**
   * Initialize queue processors for map projections.
   */
  initializeMapQueues(): void {
    if (this.mapProjections.size === 0) return;

    const handlerDefs: Record<
      string,
      {
        name: string;
        handler: {
          handle: (event: EventType) => Promise<void>;
          handleBatch: (events: EventType[]) => Promise<void>;
        };
        options: any;
      }
    > = {};

    for (const [name, mapProj] of this.mapProjections) {
      handlerDefs[name] = {
        name,
        handler: {
          handle: async (event: EventType) => {
            // Defer or skip if projection-replay is active for this aggregate.
            // Mirrors the fold projection replay-marker check.
            if (this.replayMarkerChecker) {
              const decision = await this.replayMarkerChecker.check(name, event);
              if (decision === "skip") return;
            }

            const context = await this.buildStoreContext({ event });
            const record = await withMetrics({
              fn: () => this.mapExecutor.execute(mapProj, event, context),
              onComplete: (ms) => {
                incrementEsMapProjectionTotal({
                  pipelineName: this.pipelineName,
                  projectionName: name,
                  status: "completed",
                });
                observeEsMapProjectionDuration({
                  pipelineName: this.pipelineName,
                  projectionName: name,
                  durationMs: ms,
                });
              },
              onFail: (ms) => {
                incrementEsMapProjectionTotal({
                  pipelineName: this.pipelineName,
                  projectionName: name,
                  status: "failed",
                });
                observeEsMapProjectionDuration({
                  pipelineName: this.pipelineName,
                  projectionName: name,
                  durationMs: ms,
                });
              },
            });

            // Dispatch to map subscribers after map execute succeeds
            const mapSubscribers = this.subscribersForMap.get(name);
            if (record !== null && mapSubscribers && mapSubscribers.length > 0) {
              await this.dispatchToSubscribers({
                projectionName: name,
                subscribers: mapSubscribers,
                deliveries: [{ event, foldState: record }],
              });
            }
          },
          handleBatch: async (events: EventType[]) => {
            const toApply: EventType[] = [];
            for (const event of events) {
              if (this.replayMarkerChecker) {
                const decision = await this.replayMarkerChecker.check(name, event);
                if (decision === "skip") continue;
              }
              toApply.push(event);
            }
            if (toApply.length === 0) return;

            const firstContext = await this.buildStoreContext({
              event: toApply[0]!,
            });
            const contexts = toApply.map((event) => ({
              ...firstContext,
              aggregateId: String(event.aggregateId),
              // Per-event tenantId keeps the executor's cross-tenant guard honest.
              tenantId: event.tenantId,
            }));
            const mapped = await withMetrics({
              fn: () => this.mapExecutor.executeBatch(mapProj, toApply, contexts),
              onComplete: (ms) => {
                for (const _event of toApply) {
                  incrementEsMapProjectionTotal({
                    pipelineName: this.pipelineName,
                    projectionName: name,
                    status: "completed",
                  });
                }
                observeEsMapProjectionDuration({
                  pipelineName: this.pipelineName,
                  projectionName: name,
                  durationMs: ms,
                });
              },
              onFail: (ms) => {
                for (const _event of toApply) {
                  incrementEsMapProjectionTotal({
                    pipelineName: this.pipelineName,
                    projectionName: name,
                    status: "failed",
                  });
                }
                observeEsMapProjectionDuration({
                  pipelineName: this.pipelineName,
                  projectionName: name,
                  durationMs: ms,
                });
              },
            });

            const mapSubscribers = this.subscribersForMap.get(name);
            if (mapSubscribers && mapSubscribers.length > 0) {
              // One dispatch for the whole batch: per-event dispatch would put
              // each send in its own call, so the collapse-by-job-id above
              // never saw more than one event to collapse.
              await this.dispatchToSubscribers({
                projectionName: name,
                subscribers: mapSubscribers,
                deliveries: mapped.map(({ event, record }) => ({
                  event,
                  foldState: record,
                })),
              });
            }
          },
        },
        options: {
          eventTypes: mapProj.eventTypes as readonly string[],
          concurrency: mapProj.options?.concurrency,
          disabled: mapProj.options?.disabled,
          groupKeyFn: mapProj.options?.groupKeyFn,
          coalesceMaxBatch: mapProj.options?.coalesceMaxBatch,
        },
      };
    }

    this.queueManager.initializeHandlerQueues(
      handlerDefs,
      async (handlerName, event, _context) => {
        const handlerDef = handlerDefs[handlerName];
        if (!handlerDef) {
          throw new ConfigurationError(
            "ProjectionRouter",
            `Map projection handler "${handlerName}" not found`,
            { handlerName },
          );
        }
        await handlerDef.handler.handle(event);
      },
      async (handlerName, events, _context) => {
        const handlerDef = handlerDefs[handlerName];
        if (!handlerDef) {
          throw new ConfigurationError(
            "ProjectionRouter",
            `Map projection handler "${handlerName}" not found`,
            { handlerName },
          );
        }
        await handlerDef.handler.handleBatch(events);
      },
    );
  }

  /**
   * Dispatches events to all matching fold and map projections.
   */
  async dispatch(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    return await this.tracer.withActiveSpan(
      "ProjectionRouter.dispatch",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.type": this.aggregateType,
          "event.count": events.length,
          "tenant.id": context.tenantId,
          "fold.count": this.foldProjections.size,
          "state_projection.count": this.stateProjections.size,
          "map.count": this.mapProjections.size,
          "subscriber.count": this.eventSubscribers.size,
        },
      },
      async () => {
        EventUtils.validateTenantId(context, "ProjectionRouter.dispatch");

        const errors: Error[] = [];

        // Dispatch to fold projections
        if (this.foldProjections.size > 0) {
          try {
            await this.dispatchToFoldProjections(events, context);
          } catch (e) {
            if (e instanceof AggregateError) {
              errors.push(...(e.errors as Error[]));
            } else {
              errors.push(toError(e));
            }
          }
        }

        // Default state projections are independent operational read models.
        if (this.stateProjections.size > 0) {
          try {
            await this.dispatchToStateProjections(events, context);
          } catch (e) {
            if (e instanceof AggregateError) {
              errors.push(...(e.errors as Error[]));
            } else {
              errors.push(toError(e));
            }
          }
        }

        // Dispatch to map projections
        if (this.mapProjections.size > 0) {
          try {
            await this.dispatchToMapProjections(events, context);
          } catch (e) {
            if (e instanceof AggregateError) {
              errors.push(...(e.errors as Error[]));
            } else {
              errors.push(toError(e));
            }
          }
        }

        // Subscribers receive the same committed event envelope and are not
        // coupled to either projection's state or completion.
        if (this.eventSubscribers.size > 0) {
          try {
            await this.dispatchToEventSubscribers(events);
          } catch (e) {
            if (e instanceof AggregateError) {
              errors.push(...(e.errors as Error[]));
            } else {
              errors.push(toError(e));
            }
          }
        }

        if (errors.length > 0) {
          throw new AggregateError(errors, `${errors.length} projection(s) failed during dispatch`);
        }
      },
    );
  }

  private async dispatchToFoldProjections(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    const hasProjectionQueues = this.queueManager.hasProjectionQueues();
    const errors: Error[] = [];

    if (hasProjectionQueues) {
      // Async dispatch via queues using batching
      for (const [projectionName, fold] of this.foldProjections) {
        const matching =
          fold.eventTypes.length > 0
            ? events.filter((e) => fold.eventTypes.includes(e.type))
            : [...events];
        const filtered =
          fold.options?.eventOrdering === "acceptedAt"
            ? [...matching].sort((a, b) => {
                if (a.createdAt !== b.createdAt) {
                  return a.createdAt - b.createdAt;
                }
                return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
              })
            : matching;
        if (filtered.length === 0) continue;

        const queueProcessor = this.queueManager.getProjectionQueue(projectionName);
        if (queueProcessor) {
          try {
            await queueProcessor.sendBatch(filtered);
          } catch (error) {
            this.logger.error(
              {
                projectionName,
                eventCount: filtered.length,
                error: error instanceof Error ? error.message : String(error),
              },
              "Failed to dispatch batch of events to fold projection queue",
            );
            errors.push(toError(error));
          }
        }
      }
    } else {
      // Inline sync processing
      for (const event of events) {
        for (const [projectionName, fold] of this.foldProjections) {
          if (fold.eventTypes.length > 0 && !fold.eventTypes.includes(event.type)) {
            continue;
          }
          try {
            await this.processFoldProjectionEvent(projectionName, fold, event, context);
          } catch (error) {
            const category = categorizeError(error);
            handleError(error, category, this.logger, {
              projectionName,
              aggregateId: String(event.aggregateId),
              tenantId: context.tenantId,
            });
            errors.push(toError(error));
          }
        }
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `${errors.length} fold projection(s) failed during dispatch`,
      );
    }
  }

  private async dispatchToStateProjections(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    const queued = this.queueManager.hasStateProjectionQueues();
    const errors: Error[] = [];

    for (const [name, projection] of this.stateProjections) {
      const matching =
        projection.eventTypes.length === 0
          ? [...events]
          : events.filter((event) => projection.eventTypes.includes(event.type));
      if (matching.length === 0) continue;

      try {
        if (queued) {
          const queue = this.queueManager.getStateProjectionQueue(name);
          if (queue) {
            await queue.sendBatch(matching);
            continue;
          }
        }

        for (const event of matching) {
          await this.processStateProjectionEvents(name, projection, [event], context);
        }
      } catch (error) {
        this.logger.error(
          {
            projectionName: name,
            eventCount: matching.length,
            error: error instanceof Error ? error.message : String(error),
          },
          "State projection dispatch failed",
        );
        errors.push(toError(error));
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `${errors.length} state projection(s) failed during dispatch`,
      );
    }
  }

  private async dispatchToMapProjections(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    const hasHandlerQueues = this.queueManager.hasHandlerQueues();
    const errors: Error[] = [];

    if (hasHandlerQueues) {
      // Async dispatch via queues using batching per handler
      for (const [name, mapProj] of this.mapProjections) {
        if (mapProj.options?.disabled) continue;

        // Filter events for this handler
        const filteredEvents = [];
        let declined = 0;
        for (const event of events) {
          if (
            await isComponentKilled({
              killSwitch: this.killSwitch,
              aggregateType: this.aggregateType,
              componentType: "mapProjection",
              componentName: name,
              tenantId: event.tenantId,
              customKey: mapProj.options?.killSwitch?.customKey,
              logger: this.logger,
            })
          ) {
            continue;
          }

          // Filter by event type
          if (mapProj.eventTypes.length > 0 && !mapProj.eventTypes.includes(event.type)) {
            continue;
          }

          if (!this.mapEnqueueAccepts({ mapProj, name, event })) {
            declined++;
            continue;
          }
          filteredEvents.push(event);
        }

        incrementEsMapProjectionEnqueueTotal({
          pipelineName: this.pipelineName,
          projectionName: name,
          outcome: "filtered",
          count: declined,
        });
        incrementEsMapProjectionEnqueueTotal({
          pipelineName: this.pipelineName,
          projectionName: name,
          outcome: "queued",
          count: filteredEvents.length,
        });

        if (filteredEvents.length === 0) continue;

        const queueProcessor = this.queueManager.getHandlerQueue(name);
        if (queueProcessor) {
          try {
            await queueProcessor.sendBatch(filteredEvents);
          } catch (error) {
            this.logger.error(
              {
                handlerName: name,
                eventCount: filteredEvents.length,
                error: error instanceof Error ? error.message : String(error),
              },
              "Failed to dispatch batch of events to map projection queue",
            );
            errors.push(toError(error));
          }
        }
      }
    } else {
      // Inline sync processing
      for (const event of events) {
        for (const [name, mapProj] of this.mapProjections) {
          if (mapProj.options?.disabled) continue;

          if (
            await isComponentKilled({
              killSwitch: this.killSwitch,
              aggregateType: this.aggregateType,
              componentType: "mapProjection",
              componentName: name,
              tenantId: event.tenantId,
              customKey: mapProj.options?.killSwitch?.customKey,
              logger: this.logger,
            })
          ) {
            continue;
          }

          if (mapProj.eventTypes.length > 0 && !mapProj.eventTypes.includes(event.type)) {
            continue;
          }

          // The same gate the queued branch applies, so the inline path (tests,
          // queue-less runtimes) reaches the same set of mapped records. There
          // is no job to avoid minting here — the win is only the skipped
          // execute — but a seam that answered differently in the two modes
          // would make every inline test a lie about production.
          if (!this.mapEnqueueAccepts({ mapProj, name, event })) {
            incrementEsMapProjectionEnqueueTotal({
              pipelineName: this.pipelineName,
              projectionName: name,
              outcome: "filtered",
            });
            continue;
          }
          incrementEsMapProjectionEnqueueTotal({
            pipelineName: this.pipelineName,
            projectionName: name,
            outcome: "queued",
          });

          try {
            // Defer or skip if projection-replay is active for this aggregate.
            // Mirrors the fold projection replay-marker check.
            if (this.replayMarkerChecker) {
              const decision = await this.replayMarkerChecker.check(name, event);
              if (decision === "skip") continue;
            }

            const storeContext = await this.buildStoreContext({ event });
            const record = await withMetrics({
              fn: () => this.mapExecutor.execute(mapProj, event, storeContext),
              onComplete: (ms) => {
                incrementEsMapProjectionTotal({
                  pipelineName: this.pipelineName,
                  projectionName: name,
                  status: "completed",
                });
                observeEsMapProjectionDuration({
                  pipelineName: this.pipelineName,
                  projectionName: name,
                  durationMs: ms,
                });
              },
              onFail: (ms) => {
                incrementEsMapProjectionTotal({
                  pipelineName: this.pipelineName,
                  projectionName: name,
                  status: "failed",
                });
                observeEsMapProjectionDuration({
                  pipelineName: this.pipelineName,
                  projectionName: name,
                  durationMs: ms,
                });
              },
            });

            // Dispatch to map subscribers after map execute succeeds
            const mapSubscribers = this.subscribersForMap.get(name);
            if (record !== null && mapSubscribers && mapSubscribers.length > 0) {
              await this.dispatchToSubscribers({
                projectionName: name,
                subscribers: mapSubscribers,
                deliveries: [{ event, foldState: record }],
              });
            }
          } catch (error) {
            handleError(error, categorizeError(error), this.logger, {
              handlerName: name,
              eventType: event.type,
              aggregateId: String(event.aggregateId),
              tenantId: event.tenantId,
            });
            errors.push(toError(error));
          }
        }
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, `${errors.length} map projection(s) failed during dispatch`);
    }
  }

  /**
   * The map projection's enqueue-time gate (ADR-069 invariant 4). Fail-OPEN
   * on a throw, unlike the subscriber seam — admitting costs one wasted job,
   * declining would drop a row.
   */
  private mapEnqueueAccepts({
    mapProj,
    name,
    event,
  }: {
    mapProj: MapProjectionDefinition<any, EventType>;
    name: string;
    event: EventType;
  }): boolean {
    const filter = mapProj.options?.enqueue?.filter;
    if (!filter) return true;
    try {
      return filter(event);
    } catch (error) {
      this.logger.warn(
        {
          projectionName: name,
          eventId: event.id,
          eventType: event.type,
          tenantId: String(event.tenantId),
          error: error instanceof Error ? error.message : String(error),
        },
        "Map projection enqueue filter threw; admitting the event so no record is lost",
      );
      return true;
    }
  }

  private async dispatchToEventSubscribers(events: readonly EventType[]): Promise<void> {
    const queued = this.queueManager.hasSubscriberQueues();
    const errors: Error[] = [];

    for (const [name, subscriber] of this.eventSubscribers) {
      if (subscriber.options?.disabled) continue;
      const matching =
        subscriber.eventTypes.length === 0
          ? events
          : events.filter((event) => subscriber.eventTypes.includes(event.type));

      const enqueue = subscriber.options?.enqueue;

      // Subscriber fan-out is never replayed, so this kill-switch check is
      // resolved once per distinct tenant rather than per event.
      const killedByTenant = new Map<string, boolean>();
      const isKilledFor = async (tenantId: string): Promise<boolean> => {
        const cached = killedByTenant.get(tenantId);
        if (cached !== undefined) return cached;
        const killed = await isComponentKilled({
          killSwitch: this.killSwitch,
          aggregateType: this.aggregateType,
          componentType: "subscriber",
          componentName: name,
          tenantId,
          customKey: subscriber.options?.killSwitch?.customKey,
          logger: this.logger,
        });
        killedByTenant.set(tenantId, killed);
        return killed;
      };

      for (const event of matching) {
        try {
          if (await isKilledFor(event.tenantId)) {
            // Counted, not skipped silently. A kill is permanent loss for this
            // subscriber, and an operator has to be able to tell it apart from
            // a quiet subscriber — precisely when they are looking.
            incrementEsSubscriberEnqueueTotal({
              pipelineName: this.pipelineName,
              subscriberName: name,
              outcome: "killed",
            });
            continue;
          }

          // Enqueue-time filter (ADR-069 invariant 4): a throw is NOT caught
          // as `false` — it falls to the catch below and is reported, since
          // this routing path has no retry (see `EnqueueDispatchOptions`).
          if (enqueue?.filter && !enqueue.filter(event)) {
            incrementEsSubscriberEnqueueTotal({
              pipelineName: this.pipelineName,
              subscriberName: name,
              outcome: "filtered",
            });
            continue;
          }

          // Claim-check staging (ADR-069): a throw here is reported and counted
          // `failed`, permanently losing this job — no routing retry exists.
          // Deploy-order matters: a worker on the previous build silently
          // completes a reference job it can't decode. See `EnqueueDispatchOptions.stage`.
          const staged = enqueue?.stage ? (enqueue.stage(event) as EventType) : event;

          const queue = queued ? this.queueManager.getSubscriberQueue(name) : undefined;
          if (queue) {
            await queue.send(staged);
          } else {
            await this.handleSubscriber(subscriber, staged);
          }

          // Counted only once the handoff succeeded, so a queue outage never
          // inflates `staged`/`referenced`. Split is by event-type identity:
          // a `stage` that rebuilds the same type still counts as "staged".
          incrementEsSubscriberEnqueueTotal({
            pipelineName: this.pipelineName,
            subscriberName: name,
            outcome: staged.type === event.type ? "staged" : "referenced",
          });
        } catch (error) {
          // The seam has no retry, so this job is gone. Count it: without this
          // a thrown filter/stage/send moved no series at all, and a permanent
          // drop looked exactly like a quiet day.
          incrementEsSubscriberEnqueueTotal({
            pipelineName: this.pipelineName,
            subscriberName: name,
            outcome: "failed",
          });
          this.logger.error(
            {
              subscriberName: name,
              eventId: event.id,
              eventType: event.type,
              aggregateId: String(event.aggregateId),
              tenantId: event.tenantId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Event subscriber dispatch failed",
          );
          errors.push(toError(error));
        }
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `${errors.length} event subscriber(s) failed during dispatch`,
      );
    }
  }

  private async handleSubscriber(
    subscriber: EventSubscriberDefinition<EventType>,
    event: EventType,
  ): Promise<void> {
    await this.tracer.withActiveSpan(
      "EventSubscriber.handle",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "subscriber.name": subscriber.name,
          "pipeline.name": this.pipelineName,
          "event.id": event.id,
          "event.type": event.type,
          "event.aggregate_id": String(event.aggregateId),
          "tenant.id": String(event.tenantId),
        },
      },
      async () => {
        await withMetrics({
          fn: () =>
            subscriber.handle(event, {
              tenantId: String(event.tenantId),
              aggregateId: String(event.aggregateId),
            }),
          onComplete: (ms) => {
            incrementEsSubscriberTotal({
              pipelineName: this.pipelineName,
              subscriberName: subscriber.name,
              status: "completed",
            });
            observeEsSubscriberDuration({
              pipelineName: this.pipelineName,
              subscriberName: subscriber.name,
              durationMs: ms,
            });
            if (ms >= SLOW_PROJECTION_OPERATION_MS) {
              this.logger.warn(
                {
                  pipelineName: this.pipelineName,
                  subscriberName: subscriber.name,
                  durationMs: Math.round(ms),
                },
                "Event subscriber execution is slow",
              );
            }
          },
          onFail: (ms) => {
            incrementEsSubscriberTotal({
              pipelineName: this.pipelineName,
              subscriberName: subscriber.name,
              status: "failed",
            });
            observeEsSubscriberDuration({
              pipelineName: this.pipelineName,
              subscriberName: subscriber.name,
              durationMs: ms,
            });
            if (ms >= SLOW_PROJECTION_OPERATION_MS) {
              this.logger.warn(
                {
                  pipelineName: this.pipelineName,
                  subscriberName: subscriber.name,
                  durationMs: Math.round(ms),
                },
                "Failed event subscriber execution was slow",
              );
            }
          },
        });
      },
    );
  }

  private async processStateProjectionEvents(
    projectionName: string,
    projection: StateProjectionDefinition<any, EventType>,
    events: EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    if (events.length === 0) return;
    const first = events[0]!;

    await this.tracer.withActiveSpan(
      events.length === 1
        ? "ProjectionRouter.processStateProjectionEvent"
        : "ProjectionRouter.processStateProjectionBatch",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "projection.name": projectionName,
          "projection.kind": "state",
          "event.count": events.length,
          "event.id": first.id,
          "event.type": first.type,
          "event.aggregate_id": String(first.aggregateId),
          "tenant.id": String(first.tenantId),
        },
      },
      async () => {
        const readContext: EventStoreReadContext<EventType> = {
          tenantId: first.tenantId,
        };
        EventUtils.validateTenantId(readContext, "processStateProjectionEvents");

        if (
          await isComponentKilled({
            killSwitch: this.killSwitch,
            aggregateType: this.aggregateType,
            componentType: "projection",
            componentName: projectionName,
            tenantId: first.tenantId,
            customKey: projection.options?.killSwitch?.customKey,
            logger: this.logger,
          })
        ) {
          return;
        }

        let toApply = events;
        if (this.replayMarkerChecker) {
          const kept: EventType[] = [];
          for (const event of events) {
            const decision = await this.replayMarkerChecker.check(projectionName, event);
            if (decision !== "skip") kept.push(event);
          }
          toApply = kept;
        }
        if (toApply.length === 0) return;

        const key = projection.key ? projection.key(toApply[0]!) : undefined;
        const storeContext = await this.buildStoreContext({
          event: toApply[0]!,
          key,
          deliveryAttempt: context.deliveryAttempt,
        });
        await withMetrics({
          fn: () =>
            this.stateProjectionExecutor.execute({
              projection,
              events: toApply,
              context: storeContext,
            }),
          onComplete: (ms) => {
            incrementEsProjectionTotal({
              pipelineName: this.pipelineName,
              projectionKind: "state",
              projectionName,
              status: "completed",
            });
            observeEsProjectionDuration({
              pipelineName: this.pipelineName,
              projectionKind: "state",
              projectionName,
              durationMs: ms,
            });
            if (ms >= SLOW_PROJECTION_OPERATION_MS) {
              this.logger.warn(
                {
                  pipelineName: this.pipelineName,
                  projectionKind: "state",
                  projectionName,
                  eventCount: toApply.length,
                  durationMs: Math.round(ms),
                },
                "State projection execution is slow",
              );
            }
          },
          onFail: (ms) => {
            incrementEsProjectionTotal({
              pipelineName: this.pipelineName,
              projectionKind: "state",
              projectionName,
              status: "failed",
            });
            observeEsProjectionDuration({
              pipelineName: this.pipelineName,
              projectionKind: "state",
              projectionName,
              durationMs: ms,
            });
            if (ms >= SLOW_PROJECTION_OPERATION_MS) {
              this.logger.warn(
                {
                  pipelineName: this.pipelineName,
                  projectionKind: "state",
                  projectionName,
                  eventCount: toApply.length,
                  durationMs: Math.round(ms),
                },
                "Failed state projection execution was slow",
              );
            }
          },
        });
      },
    );
  }

  /**
   * Processes a single event for a fold projection (incremental).
   * The fold state in the store serves as the checkpoint — no separate checkpoint tracking needed.
   */
  private async processFoldProjectionEvent(
    projectionName: string,
    fold: FoldProjectionDefinition<any, EventType>,
    event: EventType,
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    await this.tracer.withActiveSpan(
      "ProjectionRouter.processFoldProjectionEvent",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "projection.name": projectionName,
          "event.id": event.id,
          "event.type": event.type,
          "event.aggregate_id": String(event.aggregateId),
        },
      },
      async () => {
        EventUtils.validateTenantId(context, "processFoldProjectionEvent");

        if (
          await isComponentKilled({
            killSwitch: this.killSwitch,
            aggregateType: this.aggregateType,
            componentType: "projection",
            componentName: projectionName,
            tenantId: event.tenantId,
            customKey: fold.options?.killSwitch?.customKey,
            logger: this.logger,
          })
        ) {
          return;
        }

        // Defer or skip if projection-replay is active for this aggregate
        if (this.replayMarkerChecker) {
          const decision = await this.replayMarkerChecker.check(projectionName, event);
          if (decision === "skip") return;
        }

        const key = fold.key ? fold.key(event) : undefined;
        const storeContext = await this.buildStoreContext({
          event,
          key,
          deliveryAttempt: context.deliveryAttempt,
        });

        const foldState = await withMetrics({
          fn: () => this.foldExecutor.execute(fold, event, storeContext),
          onComplete: (ms) => {
            incrementEsFoldProjectionTotal({
              pipelineName: this.pipelineName,
              projectionName,
              status: "completed",
            });
            observeEsFoldProjectionDuration({
              pipelineName: this.pipelineName,
              projectionName,
              durationMs: ms,
            });
          },
          onFail: (ms) => {
            incrementEsFoldProjectionTotal({
              pipelineName: this.pipelineName,
              projectionName,
              status: "failed",
            });
            observeEsFoldProjectionDuration({
              pipelineName: this.pipelineName,
              projectionName,
              durationMs: ms,
            });
          },
        });

        // After fold succeeds, dispatch to subscribers for this fold. The fold
        // state is durable by this point, so a throw from here redelivers
        // events the store already contains.
        await this.dispatchSubscribersAfterStore({
          projectionName,
          events: [event],
          foldState,
        });
      },
    );
  }

  /**
   * A throw here fails the job without un-writing the state, so the queue
   * redelivers events the store already holds — see {@link recordPostStoreFailure}.
   * Shared by the single-event and batch paths.
   */
  private async dispatchSubscribersAfterStore({
    projectionName,
    events,
    foldState,
  }: {
    projectionName: string;
    events: EventType[];
    foldState: unknown;
  }): Promise<void> {
    const subscribers = this.subscribersForFold.get(projectionName);
    if (!subscribers || subscribers.length === 0) return;

    try {
      await this.dispatchToSubscribers({
        projectionName,
        subscribers,
        deliveries: events.map((event) => ({ event, foldState })),
      });
    } catch (error) {
      this.recordPostStoreFailure({
        projectionName,
        stage: "reactor_dispatch",
        events,
        error,
      });
      throw error;
    }
  }

  /**
   * Distinct from a plain fold failure: the store already holds this batch,
   * so the retry re-applies it — accumulating folds double-count as a result.
   * Warn-logged with aggregate/event ids for post-incident reconciliation.
   */
  private recordPostStoreFailure({
    projectionName,
    stage,
    events,
    error,
  }: {
    projectionName: string;
    stage: "reactor_dispatch";
    events: EventType[];
    error: unknown;
  }): void {
    incrementEsFoldPostStoreFailure({ projectionName, stage });
    const first = events[0];
    this.logger.warn(
      {
        projection: projectionName,
        stage,
        tenantId: first ? String(first.tenantId) : undefined,
        aggregateId: first ? String(first.aggregateId) : undefined,
        eventCount: events.length,
        eventIds: events.slice(0, MAX_LOGGED_EVENT_IDS).map((e) => e.id),
        error: error instanceof Error ? error.message : String(error),
      },
      "Fold failed after its state was stored — the retry will re-apply events the store already holds",
    );
  }

  /**
   * A single load/apply/store cycle for same-aggregate events (see
   * `FoldProjectionExecutor.executeBatch`), used by the GroupQueue's coalescing
   * path. Subscribers fire once with the final folded state.
   */
  private async processFoldProjectionBatch(
    projectionName: string,
    fold: FoldProjectionDefinition<any, EventType>,
    events: EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    if (events.length === 0) return;

    await this.tracer.withActiveSpan(
      "ProjectionRouter.processFoldProjectionBatch",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "projection.name": projectionName,
          "event.count": events.length,
          "event.aggregate_id": String(events[0]!.aggregateId),
        },
      },
      async () => {
        EventUtils.validateTenantId(context, "processFoldProjectionBatch");

        // All events in a batch share the tenant.
        if (
          await isComponentKilled({
            killSwitch: this.killSwitch,
            aggregateType: this.aggregateType,
            componentType: "projection",
            componentName: projectionName,
            tenantId: events[0]!.tenantId,
            customKey: fold.options?.killSwitch?.customKey,
            logger: this.logger,
          })
        ) {
          return;
        }

        // Defer or skip events for which projection-replay is active.
        let toApply = events;
        if (this.replayMarkerChecker) {
          const kept: EventType[] = [];
          for (const event of events) {
            const decision = await this.replayMarkerChecker.check(projectionName, event);
            if (decision !== "skip") kept.push(event);
          }
          toApply = kept;
        }
        if (toApply.length === 0) return;

        // Apply (and dispatch subscribers) in occurredAt order — the same order
        // executeBatch folds in — so subscriber metadata and the final state are
        // consistent regardless of the order events were drained/dispatched in.
        toApply = [...toApply].sort(
          (a, b) =>
            (((a as Record<string, unknown>).occurredAt as number) ?? 0) -
            (((b as Record<string, unknown>).occurredAt as number) ?? 0),
        );

        const first = toApply[0]!;
        const key = fold.key ? fold.key(first) : undefined;
        const storeContext = await this.buildStoreContext({
          event: first,
          key,
          deliveryAttempt: context.deliveryAttempt,
          isDeliveryContinuation: context.isDeliveryContinuation,
        });

        const foldState = await withMetrics({
          fn: () => this.foldExecutor.executeBatch(fold, toApply, storeContext),
          onComplete: (ms) => {
            incrementEsFoldProjectionTotal({
              pipelineName: this.pipelineName,
              projectionName,
              status: "completed",
            });
            observeEsFoldProjectionDuration({
              pipelineName: this.pipelineName,
              projectionName,
              durationMs: ms,
            });
          },
          onFail: (ms) => {
            incrementEsFoldProjectionTotal({
              pipelineName: this.pipelineName,
              projectionName,
              status: "failed",
            });
            observeEsFoldProjectionDuration({
              pipelineName: this.pipelineName,
              projectionName,
              durationMs: ms,
            });
          },
        });

        // See ProjectionRouter.collapseByJobId for why aggregate-keyed
        // subscribers collapse here. A post-store failure re-applies the
        // whole batch, so one failure can double-count up to
        // DEFAULT_FOLD_COALESCE_MAX_BATCH events against one aggregate.
        await this.dispatchSubscribersAfterStore({
          projectionName,
          events: toApply,
          foldState,
        });
      },
    );
  }

  /**
   * Builds the context a subscriber receives. Used for both shouldDispatch and
   * handle so the predicate can never see a different shape than the handler.
   */
  private buildSubscriberDispatchContext({
    event,
    foldState,
  }: {
    event: EventType;
    foldState: unknown;
  }) {
    return {
      tenantId: event.tenantId,
      aggregateId: String(event.aggregateId),
      foldState,
      isReplay: LIVE_DISPATCH_IS_REPLAY,
    };
  }

  /**
   * Evaluates a subscriber's optional shouldDispatch predicate. Fails open: a
   * thrown predicate is logged and treated as true so a predicate bug can
   * never drop a side effect (worst case is one redundant job).
   */
  private subscriberShouldDispatch(
    subscriber: SubscriberDispatchDefinition<EventType>,
    event: EventType,
    foldState: unknown,
  ): boolean {
    if (!subscriber.shouldDispatch) return true;

    try {
      return subscriber.shouldDispatch(
        event,
        this.buildSubscriberDispatchContext({ event, foldState }),
      );
    } catch (error) {
      this.logger.error(
        {
          subscriberName: subscriber.name,
          eventId: event.id,
          eventType: event.type,
          tenantId: event.tenantId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Subscriber shouldDispatch predicate threw — failing open and dispatching",
      );
      return true;
    }
  }

  /**
   * Pre-collapses to what the queue's dedup-by-`makeJobId` would leave behind
   * anyway, sparing an aggregate-keyed subscriber N redundant round-trips.
   */
  private collapseByJobId({
    subscriber,
    deliveries,
  }: {
    subscriber: SubscriberDispatchDefinition<EventType>;
    deliveries: SubscriberDelivery<EventType>[];
  }): SubscriberDelivery<EventType>[] {
    const makeJobId = subscriber.options?.makeJobId;
    if (!makeJobId || deliveries.length < 2) return deliveries;

    try {
      // Keep the LAST delivery per job id (matches the queue's dedup squash),
      // then re-sort survivors by original index so dispatch stays in
      // occurredAt order — a bare Map would order by each key's FIRST occurrence.
      const lastIndexPerJobId = new Map<string, number>();
      deliveries.forEach((delivery, index) => {
        lastIndexPerJobId.set(makeJobId(delivery), index);
      });
      const survivors = [...lastIndexPerJobId.values()].sort((a, b) => a - b);
      if (survivors.length === deliveries.length) return deliveries;

      incrementEsReactorCollapsedTotal(
        this.pipelineName,
        subscriber.name,
        deliveries.length - survivors.length,
      );
      return survivors.map((index) => deliveries[index]!);
    } catch (error) {
      // Fail open, like `shouldDispatch`: a throwing job-id function must never
      // drop a side effect. Worst case is the un-collapsed fan-out we had before.
      this.logger.error(
        {
          subscriberName: subscriber.name,
          eventCount: deliveries.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Subscriber makeJobId threw while collapsing a batch — dispatching every event",
      );
      return deliveries;
    }
  }

  /**
   * Dispatches a coalesced batch to a fold's subscribers. Filters by
   * `shouldDispatch` BEFORE collapsing, so an aggregate-keyed subscriber gets
   * the last event it cared about, not the last event in the batch.
   */
  private async dispatchToSubscribers({
    projectionName,
    subscribers,
    deliveries,
  }: {
    projectionName: string;
    subscribers: SubscriberDispatchDefinition<EventType>[];
    deliveries: SubscriberDelivery<EventType>[];
  }): Promise<void> {
    const errors: Error[] = [];

    for (const subscriber of subscribers) {
      if (subscriber.options?.disabled) continue;
      if (this.isSubscriberExcluded(subscriber)) continue;

      const relevant: SubscriberDelivery<EventType>[] = [];
      for (const delivery of deliveries) {
        if (this.subscriberShouldDispatch(subscriber, delivery.event, delivery.foldState)) {
          relevant.push(delivery);
        } else {
          incrementEsReactorTotal(this.pipelineName, subscriber.name, "skipped");
        }
      }
      if (relevant.length === 0) continue;

      for (const { event, foldState } of this.collapseByJobId({
        subscriber,
        deliveries: relevant,
      })) {
        await this.dispatchOneToSubscriber({
          projectionName,
          subscriber,
          event,
          foldState,
          errors,
        });
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, `${errors.length} subscriber(s) failed during dispatch`);
    }
  }

  /**
   * Sends one event to one subscriber, collecting rather than throwing failures so
   * a single bad subscriber can't skip the ones after it.
   */
  private async dispatchOneToSubscriber({
    projectionName,
    subscriber,
    event,
    foldState,
    errors,
  }: {
    projectionName: string;
    subscriber: SubscriberDispatchDefinition<EventType>;
    event: EventType;
    foldState: unknown;
    errors: Error[];
  }): Promise<void> {
    const hasSubscriberQueues = this.queueManager.hasProjectionSubscriberQueues();

    if (hasSubscriberQueues) {
      const queueProcessor = this.queueManager.getProjectionSubscriberQueue(subscriber.name);
      if (queueProcessor) {
        try {
          await queueProcessor.send({ event, foldState });
        } catch (error) {
          this.logger.error(
            {
              subscriberName: subscriber.name,
              projectionName,
              eventId: event.id,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to dispatch event to subscriber queue",
          );
          errors.push(toError(error));
        }
      } else {
        // Queue expected but not found — fall back to inline execution
        this.logger.warn(
          {
            subscriberName: subscriber.name,
            projectionName,
            eventId: event.id,
          },
          "Subscriber queue not found, falling back to inline execution",
        );
        try {
          await withMetrics({
            fn: () =>
              subscriber.handle(event, this.buildSubscriberDispatchContext({ event, foldState })),
            onComplete: (ms) => {
              incrementEsReactorTotal(this.pipelineName, subscriber.name, "completed");
              observeEsReactorDuration(this.pipelineName, subscriber.name, ms);
            },
            onFail: (ms) => {
              incrementEsReactorTotal(this.pipelineName, subscriber.name, "failed");
              observeEsReactorDuration(this.pipelineName, subscriber.name, ms);
            },
          });
        } catch (error) {
          this.logger.error(
            {
              subscriberName: subscriber.name,
              projectionName,
              eventId: event.id,
              eventType: event.type,
              aggregateId: String(event.aggregateId),
              tenantId: event.tenantId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Subscriber failed during inline fallback execution",
          );
          errors.push(toError(error));
        }
      }
    } else {
      // Inline mode: call subscriber directly
      try {
        await withMetrics({
          fn: () =>
            subscriber.handle(event, this.buildSubscriberDispatchContext({ event, foldState })),
          onComplete: (ms) => {
            incrementEsReactorTotal(this.pipelineName, subscriber.name, "completed");
            observeEsReactorDuration(this.pipelineName, subscriber.name, ms);
          },
          onFail: (ms) => {
            incrementEsReactorTotal(this.pipelineName, subscriber.name, "failed");
            observeEsReactorDuration(this.pipelineName, subscriber.name, ms);
          },
        });
      } catch (error) {
        this.logger.error(
          {
            subscriberName: subscriber.name,
            projectionName,
            eventId: event.id,
            eventType: event.type,
            aggregateId: String(event.aggregateId),
            tenantId: event.tenantId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Subscriber failed during inline execution — fold state persisted in CH but subscriber side-effect (e.g. ES sync) was lost",
        );
        errors.push(toError(error));
      }
    }
  }

  /**
   * Gets a fold projection by name for a given aggregate.
   */
  async getProjectionByName<ProjectionName extends keyof ProjectionTypes & string>(
    projectionName: ProjectionName,
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    options?: { key?: string },
  ): Promise<ProjectionTypes[ProjectionName] | null> {
    EventUtils.validateTenantId(context, "getProjectionByName");

    const fold = this.foldProjections.get(projectionName);
    if (!fold) {
      const availableNames = Array.from(this.foldProjections.keys()).join(", ");
      throw new ConfigurationError(
        "ProjectionRouter",
        `Fold projection "${projectionName}" not found. Available: ${availableNames || "none"}`,
        { projectionName },
      );
    }

    const lookupKey = options?.key ?? aggregateId;
    const storeContext: ProjectionStoreContext = {
      aggregateId,
      tenantId: context.tenantId,
    };

    const state = await fold.store.tryGet(lookupKey, storeContext);
    if (state === null) return null;

    return {
      id: `${projectionName}:${context.tenantId}:${aggregateId}`,
      aggregateId,
      tenantId: context.tenantId,
      version: fold.version,
      data: state,
    } as ProjectionTypes[ProjectionName];
  }

  /**
   * Checks if a fold projection exists for a given aggregate.
   */
  async hasProjectionByName<ProjectionName extends keyof ProjectionTypes & string>(
    projectionName: ProjectionName,
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    options?: { key?: string },
  ): Promise<boolean> {
    const projection = await this.getProjectionByName(
      projectionName,
      aggregateId,
      context,
      options,
    );
    return projection !== null;
  }

  /**
   * Gets the list of registered fold projection names.
   */
  getProjectionNames(): string[] {
    return Array.from(this.foldProjections.keys());
  }

  get hasFoldProjections(): boolean {
    return this.foldProjections.size > 0;
  }

  get hasStateProjections(): boolean {
    return this.stateProjections.size > 0;
  }

  get hasMapProjections(): boolean {
    return this.mapProjections.size > 0;
  }

  get hasEventSubscribers(): boolean {
    return this.eventSubscribers.size > 0;
  }

  /** Returns true if the subscriber excludes the current execution target. */
  private isSubscriberExcluded(subscriber: SubscriberDispatchDefinition<EventType>): boolean {
    return !executionTargetMatches(subscriber.options?.runIn, this.executionTarget);
  }

  private async resolveRetention(tenantId: unknown): Promise<RetentionPolicy | null> {
    if (!this.retentionPolicyResolver) return null;
    return this.retentionPolicyResolver.resolve(String(tenantId));
  }

  /** Shared per-event context so every projection executor sees the same shape. */
  private async buildStoreContext({
    event,
    key,
    deliveryAttempt,
    isDeliveryContinuation,
  }: {
    event: EventType;
    key?: string;
    deliveryAttempt?: number;
    isDeliveryContinuation?: boolean;
  }): Promise<ProjectionStoreContext> {
    const retentionPolicy = await this.resolveRetention(event.tenantId);
    return {
      aggregateId: String(event.aggregateId),
      tenantId: event.tenantId,
      ...(key !== undefined ? { key } : {}),
      ...(deliveryAttempt !== undefined ? { deliveryAttempt } : {}),
      ...(isDeliveryContinuation !== undefined ? { isDeliveryContinuation } : {}),
      retentionPolicy,
    };
  }
}
