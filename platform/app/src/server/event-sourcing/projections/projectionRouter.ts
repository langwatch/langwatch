import { createLogger } from "@langwatch/observability";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { FeatureFlagServiceInterface } from "~/server/featureFlag/types";
import {
  incrementEsFoldProjectionTotal,
  incrementEsMapProjectionTotal,
  incrementEsProjectionTotal,
  incrementEsSubscriberEnqueueTotal,
  incrementEsSubscriberTotal,
  observeEsFoldProjectionDuration,
  observeEsMapProjectionDuration,
  observeEsProjectionDuration,
  observeEsSubscriberDuration,
  withMetrics,
} from "~/server/metrics";
import { toError } from "~/utils/posthogErrorCapture";
import type { ResolvedRetention } from "../../data-retention/retentionPolicy.schema";
import type { RetentionPolicyResolver } from "../../data-retention/retentionPolicyResolver";
import type { AggregateType } from "../domain/aggregateType";
import type { Event, Projection } from "../domain/types";
import type { KillSwitchOptions } from "../pipeline/staticBuilder.types";
import { isProcessManagerSubscriberName } from "../process-manager/subscriberName";
import type { DeduplicationStrategy } from "../queues";
import {
  ConfigurationError,
  categorizeError,
  ErrorCategory,
  handleError,
} from "../services/errorHandling";
import type { QueueManager } from "../services/queues/queueManager";
import type { EventStoreReadContext } from "../stores/eventStore.types";
import type { EventSubscriberDefinition } from "../subscribers/eventSubscriber.types";
import { EventUtils } from "../utils/event.utils";
import { isComponentDisabled } from "../utils/killSwitch";
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
 * Default cap on how many same-aggregate fold events are coalesced into one
 * load/apply/store cycle. Bounds the per-cycle drain + apply loop (and the
 * re-stage loop on failure) while collapsing a backed-up group from O(n²) to
 * O(n). A fold can opt out by setting options.coalesceMaxBatch = 1, or raise it
 * further for folds with small event payloads.
 *
 * Set to 500 (was 100): a backed-up group drains 5× fewer dispatch cycles, so a
 * large backlog (e.g. a hot trace with tens of thousands of staged fold jobs)
 * clears far faster. The cap still bounds per-cycle memory — at most this many
 * events + one fold state are held at once, unlike the full-history re-fold
 * (which the trace/experiment folds now avoid via refoldOnOutOfOrder: false).
 * Coalescing is a pure left-fold: the final state is identical to applying the
 * events one at a time (see initializeFoldQueues below), so raising it changes
 * throughput only, never correctness.
 */
export const DEFAULT_FOLD_COALESCE_MAX_BATCH = 500;
const SLOW_PROJECTION_OPERATION_MS = 5_000;

/**
 * How many times the fan-out seam hands a subscriber's batch to its queue
 * before giving the work up as lost, and the base of the ladder between
 * attempts (25ms, then 50ms).
 *
 * Small on purpose. This runs on the routing path, behind a write that has
 * already committed and a caller that is waiting on it, so the budget is sized
 * to ride out a dropped packet or a failover blink — not an outage. A queue
 * that is genuinely down still ends in `outcome="failed"` a few tens of
 * milliseconds later; what it no longer does is lose the work to one unlucky
 * send. See {@link ProjectionRouter.sendSubscriberBatch} for why re-attempting
 * is safe.
 */
const SUBSCRIBER_ENQUEUE_MAX_ATTEMPTS = 3;
const SUBSCRIBER_ENQUEUE_RETRY_BASE_MS = 25;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Errors that came back out of a subscriber's own handler, as opposed to out
 * of the queue accepting the job.
 *
 * The two are the same call on one substrate and not on the other, which is
 * why this exists rather than being implied by where the throw happened. The
 * GroupQueue resolves a send once the job is STAGED and runs the handler later
 * on its own consumer lane, with its own retry ladder — so a rejection there is
 * always a hand-off failure. The in-memory processor (the no-Redis dev and test
 * substrate) resolves a send once the job has been PROCESSED, so a rejection
 * there may be the handler's own failure travelling back up the send.
 *
 * Re-attempting the hand-off in that case would re-run a handler that already
 * ran, inside the caller's write path, which is neither what the ladder is for
 * nor something the handler lane needs — it is already durable where it is
 * durable at all. Marking the error keeps the ladder honest about which
 * failure it is looking at, without wrapping it in a type that would change the
 * message reported to the caller.
 *
 * A WeakSet rather than a field on the error: the error belongs to the
 * subscriber, and this is the router's note about it, not a property of it.
 */
const subscriberHandlerFailures = new WeakSet<object>();

const isSubscriberHandlerFailure = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  subscriberHandlerFailures.has(error);

/**
 * Central router that registers fold and map projections and dispatches events.
 *
 * - FoldProjections: enqueued to GroupQueue (per-aggregate ordering), incremental only
 * - MapProjections: enqueued to SimpleQueue (per-event, no ordering)
 */
export class ProjectionRouter<
  EventType extends Event = Event,
  ProjectionTypes extends Record<string, Projection> = Record<
    string,
    Projection
  >,
> {
  private readonly tracer = getLangWatchTracer(
    "langwatch.event-sourcing.projection-router",
  );
  private readonly logger = createLogger(
    "langwatch:event-sourcing:projection-router",
  );
  private readonly foldExecutor = new FoldProjectionExecutor();
  private readonly stateProjectionExecutor = new StateProjectionExecutor();
  private readonly mapExecutor = new MapProjectionExecutor();

  private readonly foldProjections = new Map<
    string,
    FoldProjectionDefinition<any, EventType>
  >();
  private readonly stateProjections = new Map<
    string,
    StateProjectionDefinition<any, EventType>
  >();
  private readonly mapProjections = new Map<
    string,
    MapProjectionDefinition<any, EventType>
  >();
  private readonly eventSubscribers = new Map<
    string,
    EventSubscriberDefinition<EventType>
  >();

  constructor(
    private readonly aggregateType: AggregateType,
    private readonly pipelineName: string,
    private readonly queueManager: QueueManager<EventType>,
    private readonly featureFlagService?: FeatureFlagServiceInterface,
    private readonly replayMarkerChecker?: ReplayMarkerChecker,
    private readonly retentionPolicyResolver?: RetentionPolicyResolver,
  ) {}

  registerFoldProjection(
    projection: FoldProjectionDefinition<any, EventType>,
  ): void {
    if (this.foldProjections.has(projection.name)) {
      throw new ConfigurationError(
        "ProjectionRouter",
        `Fold projection with name "${projection.name}" already registered`,
        { projectionName: projection.name },
      );
    }
    this.assertCoalesceWithinAppliedIdCap(projection);
    this.foldProjections.set(projection.name, projection);
  }

  /**
   * Rejects the one config combination that silently breaks redelivery dedup.
   *
   * A store that exposes `getWithApplied` carries a durable (ClickHouse)
   * applied-event-id watermark that is NOT trimmed, while its Redis cache trims
   * the applied set to `MAX_APPLIED_EVENT_IDS`. If such a fold coalesces a batch
   * at or above that cap, a single fresh batch can leave ids that survive only
   * in ClickHouse: a cache-hit retry deduping against the trimmed Redis set
   * re-applies them and double-counts. Cache-only folds trim identically in both
   * places and have no such window, so the guard binds only durable-watermark
   * folds. The effective batch mirrors `initializeFoldQueues`' resolution
   * (`coalesceMaxBatch ?? DEFAULT_FOLD_COALESCE_MAX_BATCH`).
   */
  private assertCoalesceWithinAppliedIdCap(
    projection: FoldProjectionDefinition<any, EventType>,
  ): void {
    const hasDurableWatermark =
      typeof (projection.store as { getWithApplied?: unknown })
        .getWithApplied === "function";
    if (!hasDurableWatermark) return;

    const effectiveBatch =
      projection.options?.coalesceMaxBatch ?? DEFAULT_FOLD_COALESCE_MAX_BATCH;
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

  registerStateProjection(
    projection: StateProjectionDefinition<any, EventType>,
  ): void {
    if (this.stateProjections.has(projection.name)) {
      throw new ConfigurationError(
        "ProjectionRouter",
        `Projection with name "${projection.name}" already registered`,
        { projectionName: projection.name },
      );
    }
    this.stateProjections.set(projection.name, projection);
  }

  registerMapProjection(
    projection: MapProjectionDefinition<any, EventType>,
  ): void {
    if (this.mapProjections.has(projection.name)) {
      throw new ConfigurationError(
        "ProjectionRouter",
        `Map projection with name "${projection.name}" already registered`,
        { projectionName: projection.name },
      );
    }
    this.mapProjections.set(projection.name, projection);
  }

  registerEventSubscriber(
    subscriber: EventSubscriberDefinition<EventType>,
  ): void {
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
          spanAttributes: (
            event: EventType,
          ) => Record<string, string | number | boolean>;
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

    this.queueManager.initializeSubscriberQueues(
      subscriberDefs,
      async (subscriberName, event) => {
        const subscriber = this.eventSubscribers.get(subscriberName);
        if (!subscriber) {
          throw new ConfigurationError(
            "ProjectionRouter",
            `Event subscriber "${subscriberName}" not found`,
            { subscriberName },
          );
        }
        await this.handleSubscriber(subscriber, event);
      },
    );
  }

  /**
   * Initialize the default operational state projection lane.
   *
   * It shares the fold executor's pure load/apply/store mechanics, but the
   * runtime never wires history loaders for it.
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
        options?: { killSwitch?: KillSwitchOptions };
      }
    > = {};

    for (const [name, projection] of this.stateProjections) {
      projectionDefs[name] = {
        name,
        groupKeyFn: projection.key,
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
        await this.processStateProjectionEvents(
          projectionName,
          projection,
          [event],
          context,
        );
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
        await this.processStateProjectionEvents(
          projectionName,
          projection,
          events,
          context,
        );
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
        options?: { killSwitch?: KillSwitchOptions };
      }
    > = {};

    for (const [name, fold] of this.foldProjections) {
      projectionDefs[name] = {
        name,
        groupKeyFn: fold.key,
        scoreFn:
          fold.options?.eventOrdering === "acceptedAt"
            ? (event) => event.createdAt
            : undefined,
        // Coalesce a backed-up group's events into one fold load/apply/store
        // cycle. On for every fold (harmless at batch size 1 when the queue
        // keeps up). Safe for all folds because the final folded state is
        // identical to applying events one at a time (pure left-fold, the
        // intermediate stores never affect the result), and out-of-order is
        // handled identically to the single-event path (executeBatch uses the
        // fold's declared ordering and the same checkpoint policy). A fold can
        // opt out via options.coalesceMaxBatch = 1.
        coalesceMaxBatch:
          fold.options?.coalesceMaxBatch ?? DEFAULT_FOLD_COALESCE_MAX_BATCH,
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

        await this.processFoldProjectionEvent(
          projectionName,
          fold,
          triggerEvent,
          {
            tenantId: triggerEvent.tenantId,
            ...(context.deliveryAttempt !== undefined
              ? { deliveryAttempt: context.deliveryAttempt }
              : {}),
          },
        );
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
              const decision = await this.replayMarkerChecker.check(
                name,
                event,
              );
              if (decision === "skip") return;
            }

            const context = await this.buildStoreContext(event);
            await withMetrics({
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
          },
          handleBatch: async (events: EventType[]) => {
            const toApply: EventType[] = [];
            for (const event of events) {
              if (this.replayMarkerChecker) {
                const decision = await this.replayMarkerChecker.check(
                  name,
                  event,
                );
                if (decision === "skip") continue;
              }
              toApply.push(event);
            }
            if (toApply.length === 0) return;

            const contexts = await this.buildStoreContexts(toApply);
            await withMetrics({
              fn: () =>
                this.mapExecutor.executeBatch(mapProj, toApply, contexts),
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
          },
        },
        options: {
          eventTypes: mapProj.eventTypes as readonly string[],
          killSwitch: mapProj.options?.killSwitch,
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
          throw new AggregateError(
            errors,
            `${errors.length} projection(s) failed during dispatch`,
          );
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

        const queueProcessor =
          this.queueManager.getProjectionQueue(projectionName);
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
          if (
            fold.eventTypes.length > 0 &&
            !fold.eventTypes.includes(event.type)
          ) {
            continue;
          }
          try {
            await this.processFoldProjectionEvent(
              projectionName,
              fold,
              event,
              context,
            );
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
          : events.filter((event) =>
              projection.eventTypes.includes(event.type),
            );
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
          await this.processStateProjectionEvents(
            name,
            projection,
            [event],
            context,
          );
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
        for (const event of events) {
          const disabled = await isComponentDisabled({
            featureFlagService: this.featureFlagService,
            aggregateType: this.aggregateType,
            componentType: "mapProjection",
            componentName: name,
            tenantId: event.tenantId,
            customKey: mapProj.options?.killSwitch?.customKey,
            logger: this.logger,
          });
          if (disabled) continue;

          // Filter by event type
          if (
            mapProj.eventTypes.length > 0 &&
            !mapProj.eventTypes.includes(event.type)
          ) {
            continue;
          }
          filteredEvents.push(event);
        }

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

          const disabled = await isComponentDisabled({
            featureFlagService: this.featureFlagService,
            aggregateType: this.aggregateType,
            componentType: "mapProjection",
            componentName: name,
            tenantId: event.tenantId,
            customKey: mapProj.options?.killSwitch?.customKey,
            logger: this.logger,
          });
          if (disabled) continue;

          if (
            mapProj.eventTypes.length > 0 &&
            !mapProj.eventTypes.includes(event.type)
          ) {
            continue;
          }

          try {
            // Defer or skip if projection-replay is active for this aggregate.
            // Mirrors the fold projection replay-marker check.
            if (this.replayMarkerChecker) {
              const decision = await this.replayMarkerChecker.check(
                name,
                event,
              );
              if (decision === "skip") continue;
            }

            const storeContext = await this.buildStoreContext(event);
            await withMetrics({
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
      throw new AggregateError(
        errors,
        `${errors.length} map projection(s) failed during dispatch`,
      );
    }
  }

  private async dispatchToEventSubscribers(
    events: readonly EventType[],
  ): Promise<void> {
    const queued = this.queueManager.hasSubscriberQueues();
    const errors: Error[] = [];

    for (const [name, subscriber] of this.eventSubscribers) {
      if (subscriber.options?.disabled) continue;
      const matching =
        subscriber.eventTypes.length === 0
          ? events
          : events.filter((event) =>
              subscriber.eventTypes.includes(event.type),
            );

      const enqueue = subscriber.options?.enqueue;

      // Kill switch, resolved BEFORE the enqueue hooks so a killed subscriber
      // does no work at all. Every other dispatch path has one; without it the
      // enqueue filter — which DROPS events irreversibly, since subscriber
      // fan-out is never replayed — could only be stopped by shipping a revert.
      //
      // Resolved once per distinct tenant in the batch rather than once per
      // event. `isComponentDisabled` is a cache lookup wrapped in a span, and
      // the highest-volume subscribers match every span_received, so a per-event
      // resolution put a lookup on the hottest path in the product to answer a
      // question whose answer cannot change within one batch — the opposite of
      // the "an irrelevant event costs nothing" doctrine this seam exists for.
      //
      // EXCEPT for a process manager's generated subscriber, which has no kill
      // switch at all. `ProcessManagerEnqueueOptions` states that `disabled` /
      // `killSwitch` are not offered to a process manager, because a killed
      // subscriber drops events and a process manager's events are durable work
      // with a deadline behind them — nothing retries the drop and nothing
      // reconciles it afterwards. That claim was only true of what a definition
      // could DECLARE: `isComponentDisabled` derives a key when none is given,
      // so `es-<agg>-subscriber-pm:<name>-killswitch` was a live switch on the
      // durable path. Skipped here rather than merely left off the Ops page: an
      // unlisted switch is still reachable through the flag store and the
      // force-enable env, and the design's answer is that it must not exist.
      const isProcessManagerSubscriber = isProcessManagerSubscriberName(name);
      const killedByTenant = new Map<string, boolean>();
      const isKilledFor = async (tenantId: string): Promise<boolean> => {
        if (isProcessManagerSubscriber) return false;
        const cached = killedByTenant.get(tenantId);
        if (cached !== undefined) return cached;
        const disabled = await isComponentDisabled({
          featureFlagService: this.featureFlagService,
          aggregateType: this.aggregateType,
          componentType: "subscriber",
          componentName: name,
          tenantId,
          customKey: subscriber.options?.killSwitch?.customKey,
          logger: this.logger,
        });
        killedByTenant.set(tenantId, disabled);
        return disabled;
      };

      // Phase 1 — the per-event enqueue decisions. Kill switch, relevance
      // filter and claim-check staging, all of them cheap and required to be
      // total. Their failures ARE terminal for the pair (a hook that throws
      // has no reason to throw less on a second call), so they are counted and
      // reported here, before anything is handed over.
      const admitted: {
        event: EventType;
        staged: EventType;
        outcome: "staged" | "referenced";
      }[] = [];

      for (const event of matching) {
        try {
          if (await isKilledFor(event.tenantId)) {
            // Counted, not skipped silently. A kill is permanent data loss for
            // this subscriber, and an operator has to be able to tell it apart
            // from a quiet subscriber — precisely when they are looking.
            incrementEsSubscriberEnqueueTotal({
              pipelineName: this.pipelineName,
              subscriberName: name,
              outcome: "killed",
            });
            continue;
          }

          // Enqueue-time filter (ADR-069 invariant 4): a declined event never
          // mints a job. A throw here is deliberately NOT caught as `false` —
          // it falls through to the catch below, so the failure is reported
          // rather than silently read as "not relevant". Nothing re-runs an
          // enqueue hook, so it must be total: if it throws, this subscriber
          // loses its job for this event. (The HAND-OFF that follows is
          // re-attempted; the hooks are not, deliberately — see
          // SUBSCRIBER_ENQUEUE_MAX_ATTEMPTS.)
          if (enqueue?.filter && !enqueue.filter(event)) {
            incrementEsSubscriberEnqueueTotal({
              pipelineName: this.pipelineName,
              subscriberName: name,
              outcome: "filtered",
            });
            continue;
          }

          // Claim-check staging (ADR-069): the subscriber may swap the staged
          // payload for a small reference event mirroring the source event's
          // scheduling identity. Total field-picks only — like the filter's, a
          // throw here is reported and counted `failed`, and permanently loses
          // this subscriber's job for this event.
          //
          // Note the deploy-order dependency this creates: a reference is a
          // different event type, and a worker running the previous build
          // silently COMPLETES a job it cannot decode. See
          // `EnqueueDispatchOptions.stage` and ADR-069.
          const staged = enqueue?.stage
            ? (enqueue.stage(event) as EventType)
            : event;

          admitted.push({
            event,
            staged,
            // A reference is a DIFFERENT event type by construction, which is
            // what the split means to an operator. Reference identity would
            // count a `stage` that rebuilt the same event as "referenced".
            outcome: staged.type === event.type ? "staged" : "referenced",
          });
        } catch (error) {
          // Nothing re-runs a hook, so this job is gone. Count it: without this
          // a thrown filter/stage moved no series at all, and a permanent drop
          // looked exactly like a quiet day.
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

      if (admitted.length === 0) continue;

      const queue = queued
        ? this.queueManager.getSubscriberQueue(name)
        : undefined;

      if (!queue) {
        // Inline configuration (no global queue). There is no queue to collapse
        // against and no hand-off to re-attempt — the handler simply runs here,
        // and its own failure is the subscriber's to own.
        for (const entry of admitted) {
          try {
            await this.handleSubscriber(subscriber, entry.staged);
            incrementEsSubscriberEnqueueTotal({
              pipelineName: this.pipelineName,
              subscriberName: name,
              outcome: entry.outcome,
            });
          } catch (error) {
            incrementEsSubscriberEnqueueTotal({
              pipelineName: this.pipelineName,
              subscriberName: name,
              outcome: "failed",
            });
            this.logger.error(
              {
                subscriberName: name,
                eventId: entry.event.id,
                eventType: entry.event.type,
                aggregateId: String(entry.event.aggregateId),
                tenantId: entry.event.tenantId,
                error: error instanceof Error ? error.message : String(error),
              },
              "Event subscriber dispatch failed",
            );
            errors.push(toError(error));
          }
        }
        continue;
      }

      // Phase 2 — reproduce the queue's own dedup squash before paying for it.
      const survivors = this.collapseSubscriberBatch({
        subscriberName: name,
        subscriber,
        admitted,
      });

      // Phase 3 — one durable hand-off for everything that survived.
      try {
        await this.sendSubscriberBatch({
          subscriberName: name,
          queue,
          payloads: survivors.map((entry) => entry.staged),
        });
        // Counted per ORIGINAL event, only once the hand-off succeeded, and
        // split by whether this event's own payload is the one that went over.
        //
        // A survivor carries the outcome its staging produced, so
        // `staged` + `referenced` is exactly the payloads paid for. Everything
        // folded onto a survivor counts `collapsed` INSTEAD — no payload was
        // ever built for it, and counting it `staged` claimed a cost that was
        // never paid, which on a hot aggregate read as thousands staged while
        // the queue was handed tens. The collapse still changes only what is
        // PAID, never what is OWED: `survivors + collapsed === admitted`, so
        // the outcomes go on summing to the events routed here and the saving
        // becomes visible instead of being hidden inside `staged`.
        for (const entry of survivors) {
          incrementEsSubscriberEnqueueTotal({
            pipelineName: this.pipelineName,
            subscriberName: name,
            outcome: entry.outcome,
          });
        }
        const collapsedAway = admitted.length - survivors.length;
        for (let counted = 0; counted < collapsedAway; counted++) {
          incrementEsSubscriberEnqueueTotal({
            pipelineName: this.pipelineName,
            subscriberName: name,
            outcome: "collapsed",
          });
        }
      } catch (error) {
        // The re-attempts are spent. Every event this batch carried — the
        // survivors and the ones collapsed onto them — has lost its job, so
        // each is counted, not just the payloads that were actually sent.
        // Note the collapsed-away events count `failed` here rather than
        // `collapsed`: `collapsed` asserts that a surviving job covers this
        // event's work, and nothing survived. Work avoided is only a saving
        // when the work it stood in for actually reached the queue.
        for (const _lost of admitted) {
          incrementEsSubscriberEnqueueTotal({
            pipelineName: this.pipelineName,
            subscriberName: name,
            outcome: "failed",
          });
        }
        this.logger.error(
          {
            subscriberName: name,
            eventCount: admitted.length,
            sentCount: survivors.length,
            firstEventId: admitted[0]?.event.id,
            eventType: admitted[0]?.event.type,
            aggregateId: String(admitted[0]?.event.aggregateId),
            tenantId: admitted[0]?.event.tenantId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Event subscriber dispatch failed",
        );
        errors.push(toError(error));
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `${errors.length} event subscriber(s) failed during dispatch`,
      );
    }
  }

  /**
   * The staged payloads a subscriber must actually be SENT, out of a batch it
   * has already admitted.
   *
   * A subscriber's dedup `makeId` is its collapse key: the queue squashes on
   * it, so N sends carrying one id leave exactly one job behind. Subscribers
   * keyed on the aggregate (`trace-update:${tenantId}:${aggregateId}`,
   * `span-stored:…`, and every process manager's enqueue window) therefore
   * produce one job however many events a backed-up group drains.
   *
   * Sending all N anyway is not free, and the cost lands BEFORE the squash can
   * refund it: the queue serialises and compresses each payload, and past the
   * envelope's inline ceiling writes a content-addressed blob, and only then
   * does the Lua recognise the duplicate and reclaim what it just wrote. With a
   * coalesced fold batch draining up to {@link DEFAULT_FOLD_COALESCE_MAX_BATCH}
   * events, that is hundreds of discarded round-trips per drained batch, per
   * subscriber. Collapsing here reaches the same queue state by the same rule
   * the queue itself would have applied, without the churn.
   *
   * Only an explicit `DeduplicationConfig` collapses. The `"aggregate"`
   * shorthand is resolved inside the QueueManager against its own default id
   * function, and reproducing that here would be a second copy of a queue
   * internal free to drift from the first; no subscriber uses the shorthand
   * today, so the conservative reading costs nothing. A subscriber with no
   * dedup at all is not collapsible by definition — every event is its own job.
   */
  private collapseSubscriberBatch<
    Entry extends { event: EventType; staged: EventType },
  >({
    subscriberName,
    subscriber,
    admitted,
  }: {
    subscriberName: string;
    subscriber: EventSubscriberDefinition<EventType>;
    admitted: Entry[];
  }): Entry[] {
    const dedup = subscriber.options?.deduplication;
    if (!dedup || typeof dedup === "string" || admitted.length < 2) {
      return admitted;
    }

    try {
      // Which duplicate the queue leaves behind follows `replace`: the default
      // overwrites the stored value, so the LAST send wins; `replace: false`
      // keeps the value already there, so the FIRST does. The collapse has to
      // agree with the queue on this or it changes which event's payload the
      // handler eventually sees.
      const keepLast = dedup.replace !== false;
      const indexPerKey = new Map<string, number>();
      admitted.forEach((entry, index) => {
        // `makeId` is applied to the payload as SENT — the queue keys on what
        // it is handed, which is the staged claim-check when there is one.
        const key = dedup.makeId(entry.staged);
        if (keepLast || !indexPerKey.has(key)) indexPerKey.set(key, index);
      });
      if (indexPerKey.size === admitted.length) return admitted;

      // A Map alone orders survivors by each key's FIRST occurrence while
      // holding a later value, so a batch carrying two keys could send a later
      // event before an earlier one. Re-sort by the surviving entry's position
      // — `admitted` is in dispatch order, so the index IS that order.
      return [...indexPerKey.values()]
        .sort((a, b) => a - b)
        .map((index) => admitted[index]!);
    } catch (error) {
      // Fail OPEN. A throwing key function must never drop work: the worst
      // case is the un-collapsed fan-out that was there before, which is a
      // cost, whereas a dropped event is a loss. This is why `makeId` is not
      // required to be total the way the enqueue hooks are.
      this.logger.error(
        {
          subscriberName,
          eventCount: admitted.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Subscriber deduplication key threw while collapsing a batch — sending every event",
      );
      return admitted;
    }
  }

  /**
   * Hands a subscriber's staged batch to its queue, re-attempting a transient
   * failure.
   *
   * This is the seam the reactor retirement made fragile. A reactor's hand-off
   * used to run INSIDE the fold's queued job, so a failed send failed that job
   * and the queue redelivered it. Subscribers fan out from
   * `EventSourcingService.storeEvents`, which logs a dispatch failure and
   * continues — a committed write must not be undone by a projection fault —
   * so nothing re-runs the fan-out and a single unlucky send was permanent
   * loss of that subscriber's job for those events.
   *
   * Re-attempting is safe because staging is idempotent by construction: a
   * staged job's id is `<eventId>/<jobType>/<jobName>` (ADR-080,
   * `specs/event-sourcing/staged-job-id-identity.feature`), so a re-send of
   * the same event lands on the staging member already there, overwrites it in
   * place, releases the displaced blob lease in the same eval, and skips the
   * pending counter's INCR. The ambiguous failure — the send landed, the
   * acknowledgement did not — therefore cannot double-stage, leak a blob or
   * drift the queue depth. This is also why the batch is re-sent WHOLE rather
   * than narrowed to some notion of which members failed: there is no such
   * notion, and re-sending a member that already landed costs nothing.
   *
   * It is deliberately not a durability mechanism, only a much better first
   * approximation of one. A process that dies mid-ladder still loses the batch,
   * and `es_subscriber_enqueue_total{outcome="failed"}` remains the signal that
   * it happened.
   */
  private async sendSubscriberBatch({
    subscriberName,
    queue,
    payloads,
  }: {
    subscriberName: string;
    queue: { sendBatch: (payloads: EventType[]) => Promise<void> };
    payloads: EventType[];
  }): Promise<void> {
    if (payloads.length === 0) return;

    for (let attempt = 1; ; attempt++) {
      try {
        await queue.sendBatch(payloads);
        return;
      } catch (error) {
        // The queue's own retryability rule, not a second opinion on it: a
        // CRITICAL error is a validation/security/configuration fault that a
        // second identical send reproduces exactly, so re-attempting it only
        // holds up the caller waiting on the committed write.
        const retryable =
          !isSubscriberHandlerFailure(error) &&
          categorizeError(error) !== ErrorCategory.CRITICAL;
        if (!retryable || attempt >= SUBSCRIBER_ENQUEUE_MAX_ATTEMPTS) {
          throw error;
        }

        this.logger.warn(
          {
            subscriberName,
            attempt,
            payloadCount: payloads.length,
            error: error instanceof Error ? error.message : String(error),
          },
          "Subscriber queue hand-off failed — re-attempting",
        );
        await sleep(
          SUBSCRIBER_ENQUEUE_RETRY_BASE_MS * Math.pow(2, attempt - 1),
        );
      }
    }
  }

  /**
   * Runs a subscriber's handler. This is the router's half of the CONSUMER
   * lane — the queue's registry entry lands here — as well as the whole of the
   * inline (no-queue) path.
   *
   * Anything that escapes is noted as a handler failure rather than a hand-off
   * one, because on the in-memory substrate the two travel back up the same
   * `send` and the enqueue ladder must not re-run a handler that already ran.
   * See {@link subscriberHandlerFailures}.
   */
  private async handleSubscriber(
    subscriber: EventSubscriberDefinition<EventType>,
    event: EventType,
  ): Promise<void> {
    try {
      await this.runSubscriberHandler(subscriber, event);
    } catch (error) {
      if (typeof error === "object" && error !== null) {
        subscriberHandlerFailures.add(error);
      }
      throw error;
    }
  }

  private async runSubscriberHandler(
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
        EventUtils.validateTenantId(
          readContext,
          "processStateProjectionEvents",
        );

        const disabled = await isComponentDisabled({
          featureFlagService: this.featureFlagService,
          aggregateType: this.aggregateType,
          componentType: "projection",
          componentName: projectionName,
          tenantId: first.tenantId,
          customKey: projection.options?.killSwitch?.customKey,
          logger: this.logger,
        });
        if (disabled) return;

        let toApply = events;
        if (this.replayMarkerChecker) {
          const kept: EventType[] = [];
          for (const event of events) {
            const decision = await this.replayMarkerChecker.check(
              projectionName,
              event,
            );
            if (decision !== "skip") kept.push(event);
          }
          toApply = kept;
        }
        if (toApply.length === 0) return;

        const key = projection.key ? projection.key(toApply[0]!) : undefined;
        const storeContext = await this.buildStoreContext(
          toApply[0]!,
          key,
          context.deliveryAttempt,
        );
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

        // Check kill switch
        const disabled = await isComponentDisabled({
          featureFlagService: this.featureFlagService,
          aggregateType: this.aggregateType,
          componentType: "projection",
          componentName: projectionName,
          tenantId: event.tenantId,
          customKey: fold.options?.killSwitch?.customKey,
          logger: this.logger,
        });
        if (disabled) return;

        // Defer or skip if projection-replay is active for this aggregate
        if (this.replayMarkerChecker) {
          const decision = await this.replayMarkerChecker.check(
            projectionName,
            event,
          );
          if (decision === "skip") return;
        }

        const key = fold.key ? fold.key(event) : undefined;
        const storeContext = await this.buildStoreContext(
          event,
          key,
          context.deliveryAttempt,
        );

        await withMetrics({
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
      },
    );
  }

  /**
   * Processes a batch of same-aggregate events for a fold projection in a single
   * load/apply/store cycle (see FoldProjectionExecutor.executeBatch). Used by the
   * GroupQueue's coalescing path when a group is backed up. All events share the
   * aggregate (and tenant), so kill-switch and store key are resolved once.
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

        // Check kill switch (all events share the tenant)
        const disabled = await isComponentDisabled({
          featureFlagService: this.featureFlagService,
          aggregateType: this.aggregateType,
          componentType: "projection",
          componentName: projectionName,
          tenantId: events[0]!.tenantId,
          customKey: fold.options?.killSwitch?.customKey,
          logger: this.logger,
        });
        if (disabled) return;

        // Defer or skip events for which projection-replay is active.
        let toApply = events;
        if (this.replayMarkerChecker) {
          const kept: EventType[] = [];
          for (const event of events) {
            const decision = await this.replayMarkerChecker.check(
              projectionName,
              event,
            );
            if (decision !== "skip") kept.push(event);
          }
          toApply = kept;
        }
        if (toApply.length === 0) return;

        // Apply in occurredAt order — the same order executeBatch folds in — so
        // the final state is consistent regardless of the order events were
        // drained/dispatched in.
        toApply = [...toApply].sort(
          (a, b) =>
            (((a as Record<string, unknown>).occurredAt as number) ?? 0) -
            (((b as Record<string, unknown>).occurredAt as number) ?? 0),
        );

        const first = toApply[0]!;
        const key = fold.key ? fold.key(first) : undefined;
        const storeContext = await this.buildStoreContext(
          first,
          key,
          context.deliveryAttempt,
        );

        await withMetrics({
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
      },
    );
  }

  /**
   * Gets a fold projection by name for a given aggregate.
   */
  async getProjectionByName<
    ProjectionName extends keyof ProjectionTypes & string,
  >(
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

    const state = await fold.store.get(lookupKey, storeContext);
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
  async hasProjectionByName<
    ProjectionName extends keyof ProjectionTypes & string,
  >(
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

  private async resolveRetention(
    tenantId: unknown,
  ): Promise<ResolvedRetention | null> {
    if (!this.retentionPolicyResolver) return null;
    return this.retentionPolicyResolver.resolve(String(tenantId));
  }

  /**
   * Build the per-event ProjectionStoreContext shared by all projection
   * executors (map handler, fold processFoldProjectionEvent, fold batch).
   * Centralising it ensures every store sees the same shape — and any new
   * context field (e.g. process role, trace correlation) lands in one place.
   */
  /**
   * Per-event store contexts for a batch.
   *
   * EVERY field is derived from its own event, `retentionPolicy` included.
   * It used to be resolved once from event 0 and spread across the batch
   * while `aggregateId` and `tenantId` were re-derived — and it is the field
   * that decides how long the written row SURVIVES, so a batch that ever
   * spanned tenants would stamp the first tenant's retention onto another
   * tenant's rows and the mistake would outlive the batch that made it.
   *
   * Batches are single-tenant today (grouped upstream), which is exactly why
   * memoising the resolve per tenant costs one lookup in the real case while
   * making the invariant local instead of assumed.
   */
  private async buildStoreContexts(
    events: EventType[],
  ): Promise<ProjectionStoreContext[]> {
    const retentionByTenant = new Map<string, ResolvedRetention | null>();
    const contexts: ProjectionStoreContext[] = [];
    for (const event of events) {
      const tenantKey = String(event.tenantId);
      let retentionPolicy = retentionByTenant.get(tenantKey);
      if (retentionPolicy === undefined) {
        retentionPolicy = await this.resolveRetention(event.tenantId);
        retentionByTenant.set(tenantKey, retentionPolicy);
      }
      contexts.push({
        aggregateId: String(event.aggregateId),
        // Per-event tenantId keeps the executor's cross-tenant guard honest.
        tenantId: event.tenantId,
        retentionPolicy,
      });
    }
    return contexts;
  }

  private async buildStoreContext(
    event: EventType,
    key?: string,
    deliveryAttempt?: number,
  ): Promise<ProjectionStoreContext> {
    const retentionPolicy = await this.resolveRetention(event.tenantId);
    return {
      aggregateId: String(event.aggregateId),
      tenantId: event.tenantId,
      ...(key !== undefined ? { key } : {}),
      ...(deliveryAttempt !== undefined ? { deliveryAttempt } : {}),
      retentionPolicy,
    };
  }
}
