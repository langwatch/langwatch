import { createLogger } from "@langwatch/observability";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import {
  type ProcessRole,
  roleSatisfiesRunIn,
} from "~/server/app-layer/config";
import type { FeatureFlagServiceInterface } from "~/server/featureFlag/types";
import {
  incrementEsFoldPostStoreFailure,
  incrementEsFoldProjectionTotal,
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
} from "~/server/metrics";
import { toError } from "~/utils/posthogErrorCapture";
import type { ResolvedRetention } from "../../data-retention/retentionPolicy.schema";
import type { RetentionPolicyResolver } from "../../data-retention/retentionPolicyResolver";
import type { AggregateType } from "../domain/aggregateType";
import type { Event, Projection } from "../domain/types";
import type { KillSwitchOptions } from "../pipeline/staticBuilder.types";
import type { DeduplicationStrategy } from "../queues";
import type { ReactorDefinition } from "../reactors/reactor.types";
import {
  ConfigurationError,
  categorizeError,
  handleError,
} from "../services/errorHandling";
import type { QueueManager } from "../services/queues/queueManager";
import type { EventStoreReadContext } from "../stores/eventStore.types";
import { TIME_LOCAL_AGGREGATE_TYPES } from "../stores/rehydrationWindow";
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
 * Event ids carried in a post-store-failure log line. A coalesced batch holds
 * up to DEFAULT_FOLD_COALESCE_MAX_BATCH events and the whole line would be
 * unreadable; the ids exist to locate the affected aggregate for reconciliation,
 * and the aggregate id already narrows it. eventCount reports the true size.
 */
const MAX_LOGGED_EVENT_IDS = 10;

/**
 * The router only ever dispatches reactors on the live event path — the
 * replay service (`replay/replayService.ts`) rebuilds fold projections and
 * never invokes reactors, so no reactor context here can be a replay.
 * Named constant so the `isReplay` plumbing in `ReactorContext` is honestly
 * "always false on this path" rather than looking like a forgotten TODO. If a
 * replay path that reaches reactors is ever added, it must thread a real
 * flag instead of this constant.
 */
const LIVE_DISPATCH_IS_REPLAY = false;

/**
 * One event paired with the projection state a reactor should see for it.
 *
 * A fold repeats the same accumulated state across a batch; a map produces a
 * distinct record per event. Pairing them here lets both dispatch through one
 * path without a map batch having to pick a single record to stand for all of
 * its events. It is also exactly the queue job's payload shape.
 */
type ReactorDelivery<E extends Event> = { event: E; foldState: unknown };

type ReactorQueueDef<E extends Event> = {
  name: string;
  parentProjection: string;
  parentType: "fold" | "map";
  handler: {
    handle: (payload: { event: E; foldState: unknown }) => Promise<void>;
  };
  groupKeyFn?: (payload: { event: E; foldState: unknown }) => string;
  options?: {
    killSwitch?: KillSwitchOptions;
    disabled?: boolean;
    delay?: number;
    deduplication?: DeduplicationStrategy<{ event: E; foldState: unknown }>;
  };
};

const buildReactorQueueDef = <E extends Event>({
  reactor,
  parentProjection,
  parentType,
}: {
  reactor: ReactorDefinition<E>;
  parentProjection: string;
  parentType: "fold" | "map";
}): ReactorQueueDef<E> => ({
  name: reactor.name,
  parentProjection,
  parentType,
  handler: {
    handle: async (payload) => {
      await reactor.handle(payload.event, {
        tenantId: payload.event.tenantId,
        aggregateId: String(payload.event.aggregateId),
        foldState: payload.foldState,
        isReplay: LIVE_DISPATCH_IS_REPLAY,
      });
    },
  },
  groupKeyFn: reactor.options?.groupKeyFn,
  options: {
    killSwitch: reactor.options?.killSwitch,
    disabled: reactor.options?.disabled,
    delay: reactor.options?.delay,
    deduplication:
      reactor.options?.deduplication ??
      (reactor.options?.makeJobId
        ? { makeId: reactor.options.makeJobId, ttlMs: reactor.options.ttl }
        : undefined),
  },
});

const compareByAcceptedAtThenId = (a: Event, b: Event): number => {
  if (a.createdAt !== b.createdAt) {
    return a.createdAt - b.createdAt;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

const compareByOccurredAt = (a: Event, b: Event): number =>
  (((a as Record<string, unknown>).occurredAt as number) ?? 0) -
  (((b as Record<string, unknown>).occurredAt as number) ?? 0);

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
  private readonly reactorsForFold = new Map<
    string,
    ReactorDefinition<EventType>[]
  >();
  private readonly reactorsForMap = new Map<
    string,
    ReactorDefinition<EventType>[]
  >();
  private readonly eventSubscribers = new Map<
    string,
    EventSubscriberDefinition<EventType>
  >();

  private readonly aggregateType: AggregateType;
  private readonly pipelineName: string;
  private readonly queueManager: QueueManager<EventType>;
  private readonly featureFlagService?: FeatureFlagServiceInterface;
  private readonly processRole?: ProcessRole;
  private readonly replayMarkerChecker?: ReplayMarkerChecker;
  private readonly retentionPolicyResolver?: RetentionPolicyResolver;

  constructor({
    aggregateType,
    pipelineName,
    queueManager,
    featureFlagService,
    processRole,
    replayMarkerChecker,
    retentionPolicyResolver,
  }: {
    aggregateType: AggregateType;
    pipelineName: string;
    queueManager: QueueManager<EventType>;
    featureFlagService?: FeatureFlagServiceInterface;
    processRole?: ProcessRole;
    replayMarkerChecker?: ReplayMarkerChecker;
    retentionPolicyResolver?: RetentionPolicyResolver;
  }) {
    this.aggregateType = aggregateType;
    this.pipelineName = pipelineName;
    this.queueManager = queueManager;
    this.featureFlagService = featureFlagService;
    this.processRole = processRole;
    this.replayMarkerChecker = replayMarkerChecker;
    this.retentionPolicyResolver = retentionPolicyResolver;
  }

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
    this.assertTrustedAbsenceIsTimeLocal(projection);
    this.foldProjections.set(projection.name, projection);
  }

  /**
   * Rejects a fold that trusts a WINDOWED absence on an aggregate whose rows
   * can outlive the window.
   *
   * `trustAbsentMiss` retires the unwindowed retry: an absent windowed read is
   * taken as proof nothing was ever committed, and the fold restarts from
   * `init()`. That is only true while every row of the aggregate stays inside
   * the window, which is a bet on the aggregate's LIFETIME, the same one
   * `rehydrationLowerBoundMs` makes when it bounds an event scan. A long-lived
   * aggregate (a session spanning weeks) may declare a `readWindow` for
   * partition pruning, but trusting its misses would silently overwrite live
   * state with an empty one. Unwindowed folds are untouched: with no window
   * there is nothing an absence could be hiding behind.
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

  registerReactor(
    foldName: string,
    reactor: ReactorDefinition<EventType>,
  ): void {
    if (!this.foldProjections.has(foldName)) {
      throw new ConfigurationError(
        "ProjectionRouter",
        `Cannot register reactor "${reactor.name}" on fold "${foldName}" — fold not found`,
        { foldName, reactorName: reactor.name },
      );
    }

    const existing = this.reactorsForFold.get(foldName) ?? [];
    existing.push(reactor);
    this.reactorsForFold.set(foldName, existing);
  }

  registerMapReactor(
    mapName: string,
    reactor: ReactorDefinition<EventType>,
  ): void {
    if (!this.mapProjections.has(mapName)) {
      throw new ConfigurationError(
        "ProjectionRouter",
        `Cannot register reactor "${reactor.name}" on map "${mapName}" — map not found`,
        { mapName, reactorName: reactor.name },
      );
    }

    const existing = this.reactorsForMap.get(mapName) ?? [];
    existing.push(reactor);
    this.reactorsForMap.set(mapName, existing);
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
   * Initialize queue processors for reactors.
   * Each reactor gets a SimpleQueue for async dispatch.
   */
  initializeReactorQueues(): void {
    if (this.reactorsForFold.size === 0 && this.reactorsForMap.size === 0)
      return;

    const reactorDefs: Record<string, ReactorQueueDef<EventType>> = {};
    this.collectReactorDefs({
      reactorsByParent: this.reactorsForFold,
      parentType: "fold",
      reactorDefs,
    });
    this.collectReactorDefs({
      reactorsByParent: this.reactorsForMap,
      parentType: "map",
      reactorDefs,
    });

    this.queueManager.initializeReactorQueues(
      reactorDefs,
      (reactorName, payload, _context) =>
        this.runReactorQueueJob({ reactorName, payload, reactorDefs }),
    );
  }

  private collectReactorDefs({
    reactorsByParent,
    parentType,
    reactorDefs,
  }: {
    reactorsByParent: Map<string, ReactorDefinition<EventType>[]>;
    parentType: "fold" | "map";
    reactorDefs: Record<string, ReactorQueueDef<EventType>>;
  }): void {
    for (const [parentProjection, reactors] of reactorsByParent) {
      for (const reactor of reactors) {
        if (this.isReactorExcluded(reactor)) continue;
        reactorDefs[reactor.name] = buildReactorQueueDef({
          reactor,
          parentProjection,
          parentType,
        });
      }
    }
  }

  private async runReactorQueueJob({
    reactorName,
    payload,
    reactorDefs,
  }: {
    reactorName: string;
    payload: { event: EventType; foldState: unknown };
    reactorDefs: Record<string, ReactorQueueDef<EventType>>;
  }): Promise<void> {
    const reactorDef = reactorDefs[reactorName];
    if (!reactorDef) {
      throw new ConfigurationError(
        "ProjectionRouter",
        `Reactor "${reactorName}" not found`,
        { reactorName },
      );
    }
    await withMetrics({
      fn: () => reactorDef.handler.handle(payload),
      onComplete: (ms) => {
        incrementEsReactorTotal(this.pipelineName, reactorName, "completed");
        observeEsReactorDuration(this.pipelineName, reactorName, ms);
      },
      onFail: (ms) => {
        incrementEsReactorTotal(this.pipelineName, reactorName, "failed");
        observeEsReactorDuration(this.pipelineName, reactorName, ms);
      },
    });
  }

  /**
   * Initialize the default operational state projection lane.
   *
   * It shares the fold executor's pure load/apply/store mechanics, but the
   * runtime never wires history loaders and never dispatches reactors from the
   * resulting state.
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
        await this.processStateProjectionEvents({
          projectionName,
          projection,
          events: [event],
          context,
        });
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
        await this.processStateProjectionEvents({
          projectionName,
          projection,
          events,
          context,
        });
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
        // keeps up). Safe for all folds because: the final folded state is
        // identical to applying events one at a time (pure left-fold, the
        // intermediate stores never affect the result); processFoldProjectionBatch
        // still dispatches reactors per event, so event-sensitive reactors
        // (per-span eval sync, evaluation/scenario triggers keyed on event type)
        // see every event; and out-of-order is handled identically to the
        // single-event path (executeBatch uses the fold's declared ordering and
        // the same checkpoint policy). The only difference is reactors observe the final
        // batch fold-state, which is the correct "current state" for a
        // react-after-fold side effect. A fold can opt out via
        // options.coalesceMaxBatch = 1.
        coalesceMaxBatch:
          fold.options?.coalesceMaxBatch ?? DEFAULT_FOLD_COALESCE_MAX_BATCH,
        options: fold.options,
      };
    }

    this.queueManager.initializeProjectionQueues({
      projections: projectionDefs,
      onEvent: async (projectionName, triggerEvent, context) => {
        const fold = this.foldProjections.get(projectionName);
        if (!fold) {
          throw new ConfigurationError(
            "ProjectionRouter",
            `Fold projection "${projectionName}" not found`,
            { projectionName },
          );
        }

        await this.processFoldProjectionEvent({
          projectionName,
          fold,
          event: triggerEvent,
          context: {
            tenantId: triggerEvent.tenantId,
            ...(context.deliveryAttempt !== undefined
              ? { deliveryAttempt: context.deliveryAttempt }
              : {}),
          },
        });
      },
      onEventBatch: async (projectionName, events, context) => {
        const fold = this.foldProjections.get(projectionName);
        if (!fold) {
          throw new ConfigurationError(
            "ProjectionRouter",
            `Fold projection "${projectionName}" not found`,
            { projectionName },
          );
        }

        await this.processFoldProjectionBatch({
          projectionName,
          fold,
          events,
          context: {
            tenantId: events[0]!.tenantId,
            ...(context.deliveryAttempt !== undefined
              ? { deliveryAttempt: context.deliveryAttempt }
              : {}),
          },
        });
      },
    });
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
          handle: (event) => this.handleMapEvent({ name, mapProj, event }),
          handleBatch: (events) =>
            this.handleMapEventBatch({ name, mapProj, events }),
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

  private emitMapProjectionMetrics({
    name,
    status,
    durationMs,
    count,
  }: {
    name: string;
    status: "completed" | "failed";
    durationMs: number;
    count: number;
  }): void {
    for (let i = 0; i < count; i++) {
      incrementEsMapProjectionTotal({
        pipelineName: this.pipelineName,
        projectionName: name,
        status,
      });
    }
    observeEsMapProjectionDuration({
      pipelineName: this.pipelineName,
      projectionName: name,
      durationMs,
    });
  }

  private async handleMapEvent({
    name,
    mapProj,
    event,
  }: {
    name: string;
    mapProj: MapProjectionDefinition<any, EventType>;
    event: EventType;
  }): Promise<void> {
    // Defer or skip if projection-replay is active for this aggregate.
    // Mirrors the fold projection replay-marker check.
    if (this.replayMarkerChecker) {
      const decision = await this.replayMarkerChecker.check(name, event);
      if (decision === "skip") return;
    }

    const context = await this.buildStoreContext(event);
    const record = await withMetrics({
      fn: () => this.mapExecutor.execute(mapProj, event, context),
      onComplete: (ms) =>
        this.emitMapProjectionMetrics({
          name,
          status: "completed",
          durationMs: ms,
          count: 1,
        }),
      onFail: (ms) =>
        this.emitMapProjectionMetrics({
          name,
          status: "failed",
          durationMs: ms,
          count: 1,
        }),
    });

    // Dispatch to map reactors after map execute succeeds
    const mapReactors = this.reactorsForMap.get(name);
    if (record !== null && mapReactors && mapReactors.length > 0) {
      await this.dispatchToReactors({
        foldName: name,
        reactors: mapReactors,
        deliveries: [{ event, foldState: record }],
      });
    }
  }

  private async handleMapEventBatch({
    name,
    mapProj,
    events,
  }: {
    name: string;
    mapProj: MapProjectionDefinition<any, EventType>;
    events: EventType[];
  }): Promise<void> {
    const toApply: EventType[] = [];
    for (const event of events) {
      if (this.replayMarkerChecker) {
        const decision = await this.replayMarkerChecker.check(name, event);
        if (decision === "skip") continue;
      }
      toApply.push(event);
    }
    if (toApply.length === 0) return;

    const firstContext = await this.buildStoreContext(toApply[0]!);
    const contexts = toApply.map((event) => ({
      ...firstContext,
      aggregateId: String(event.aggregateId),
      // Per-event tenantId keeps the executor's cross-tenant guard honest.
      tenantId: event.tenantId,
    }));
    const mapped = await withMetrics({
      fn: () => this.mapExecutor.executeBatch(mapProj, toApply, contexts),
      onComplete: (ms) =>
        this.emitMapProjectionMetrics({
          name,
          status: "completed",
          durationMs: ms,
          count: toApply.length,
        }),
      onFail: (ms) =>
        this.emitMapProjectionMetrics({
          name,
          status: "failed",
          durationMs: ms,
          count: toApply.length,
        }),
    });

    const mapReactors = this.reactorsForMap.get(name);
    if (mapReactors && mapReactors.length > 0) {
      // One dispatch for the whole batch, not one per mapped event.
      // Dispatching per event put each send in its own call, so the
      // per-reactor collapse only ever saw a single event and could
      // never fire — a drained batch sent one job per event for
      // reactors keyed on the aggregate, and the queue then squashed
      // all but the last. Each delivery keeps its own record, so a
      // reactor that reads one still sees the record its event
      // produced.
      await this.dispatchToReactors({
        foldName: name,
        reactors: mapReactors,
        deliveries: mapped.map(({ event, record }) => ({
          event,
          foldState: record,
        })),
      });
    }
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
          await this.runDispatchStage({
            errors,
            run: () => this.dispatchToFoldProjections(events, context),
          });
        }

        // Default state projections are independent operational read models.
        if (this.stateProjections.size > 0) {
          await this.runDispatchStage({
            errors,
            run: () => this.dispatchToStateProjections(events, context),
          });
        }

        // Dispatch to map projections
        if (this.mapProjections.size > 0) {
          await this.runDispatchStage({
            errors,
            run: () => this.dispatchToMapProjections(events, context),
          });
        }

        // Subscribers receive the same committed event envelope and are not
        // coupled to either projection's state or completion.
        if (this.eventSubscribers.size > 0) {
          await this.runDispatchStage({
            errors,
            run: () => this.dispatchToEventSubscribers(events),
          });
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

  private async runDispatchStage({
    errors,
    run,
  }: {
    errors: Error[];
    run: () => Promise<void>;
  }): Promise<void> {
    try {
      await run();
    } catch (e) {
      if (e instanceof AggregateError) {
        errors.push(...(e.errors as Error[]));
      } else {
        errors.push(toError(e));
      }
    }
  }

  private async dispatchToFoldProjections(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    const errors: Error[] = [];

    if (this.queueManager.hasProjectionQueues()) {
      await this.dispatchFoldProjectionsViaQueue({ events, errors });
    } else {
      await this.dispatchFoldProjectionsInline({ events, context, errors });
    }

    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `${errors.length} fold projection(s) failed during dispatch`,
      );
    }
  }

  private filterFoldMatchingEvents({
    fold,
    events,
  }: {
    fold: FoldProjectionDefinition<any, EventType>;
    events: readonly EventType[];
  }): EventType[] {
    const matching =
      fold.eventTypes.length > 0
        ? events.filter((e) => fold.eventTypes.includes(e.type))
        : [...events];
    return fold.options?.eventOrdering === "acceptedAt"
      ? [...matching].sort(compareByAcceptedAtThenId)
      : matching;
  }

  // Async dispatch via queues using batching
  private async dispatchFoldProjectionsViaQueue({
    events,
    errors,
  }: {
    events: readonly EventType[];
    errors: Error[];
  }): Promise<void> {
    for (const [projectionName, fold] of this.foldProjections) {
      const filtered = this.filterFoldMatchingEvents({ fold, events });
      if (filtered.length === 0) continue;
      await this.sendFoldProjectionBatch({ projectionName, filtered, errors });
    }
  }

  private async sendFoldProjectionBatch({
    projectionName,
    filtered,
    errors,
  }: {
    projectionName: string;
    filtered: EventType[];
    errors: Error[];
  }): Promise<void> {
    const queueProcessor = this.queueManager.getProjectionQueue(projectionName);
    if (!queueProcessor) return;

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

  // Inline sync processing
  private async dispatchFoldProjectionsInline({
    events,
    context,
    errors,
  }: {
    events: readonly EventType[];
    context: EventStoreReadContext<EventType>;
    errors: Error[];
  }): Promise<void> {
    for (const event of events) {
      for (const [projectionName, fold] of this.foldProjections) {
        if (
          fold.eventTypes.length > 0 &&
          !fold.eventTypes.includes(event.type)
        ) {
          continue;
        }
        try {
          await this.processFoldProjectionEvent({
            projectionName,
            fold,
            event,
            context,
          });
        } catch (error) {
          const category = categorizeError(error);
          handleError({
            error,
            category,
            logger: this.logger,
            context: {
              projectionName,
              aggregateId: String(event.aggregateId),
              tenantId: context.tenantId,
            },
          });
          errors.push(toError(error));
        }
      }
    }
  }

  private filterStateProjectionMatchingEvents({
    projection,
    events,
  }: {
    projection: StateProjectionDefinition<any, EventType>;
    events: readonly EventType[];
  }): EventType[] {
    return projection.eventTypes.length === 0
      ? [...events]
      : events.filter((event) => projection.eventTypes.includes(event.type));
  }

  private async dispatchToStateProjections(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    const queued = this.queueManager.hasStateProjectionQueues();
    const errors: Error[] = [];

    for (const [name, projection] of this.stateProjections) {
      const matching = this.filterStateProjectionMatchingEvents({
        projection,
        events,
      });
      if (matching.length === 0) continue;

      try {
        await this.dispatchStateProjectionMatch({
          name,
          projection,
          matching,
          context,
          queued,
        });
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

  private async dispatchStateProjectionMatch({
    name,
    projection,
    matching,
    context,
    queued,
  }: {
    name: string;
    projection: StateProjectionDefinition<any, EventType>;
    matching: EventType[];
    context: EventStoreReadContext<EventType>;
    queued: boolean;
  }): Promise<void> {
    if (queued) {
      const queue = this.queueManager.getStateProjectionQueue(name);
      if (queue) {
        await queue.sendBatch(matching);
        return;
      }
    }

    for (const event of matching) {
      await this.processStateProjectionEvents({
        projectionName: name,
        projection,
        events: [event],
        context,
      });
    }
  }

  private async dispatchToMapProjections(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    const errors: Error[] = [];

    if (this.queueManager.hasHandlerQueues()) {
      await this.dispatchMapProjectionsViaQueue({ events, errors });
    } else {
      await this.dispatchMapProjectionsInline({ events, errors });
    }

    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `${errors.length} map projection(s) failed during dispatch`,
      );
    }
  }

  private async filterMapEventsForHandler({
    name,
    mapProj,
    events,
  }: {
    name: string;
    mapProj: MapProjectionDefinition<any, EventType>;
    events: readonly EventType[];
  }): Promise<EventType[]> {
    const filteredEvents: EventType[] = [];
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
    return filteredEvents;
  }

  // Async dispatch via queues using batching per handler
  private async dispatchMapProjectionsViaQueue({
    events,
    errors,
  }: {
    events: readonly EventType[];
    errors: Error[];
  }): Promise<void> {
    for (const [name, mapProj] of this.mapProjections) {
      if (mapProj.options?.disabled) continue;

      const filteredEvents = await this.filterMapEventsForHandler({
        name,
        mapProj,
        events,
      });
      if (filteredEvents.length === 0) continue;

      await this.sendMapProjectionBatch({ name, filteredEvents, errors });
    }
  }

  private async sendMapProjectionBatch({
    name,
    filteredEvents,
    errors,
  }: {
    name: string;
    filteredEvents: EventType[];
    errors: Error[];
  }): Promise<void> {
    const queueProcessor = this.queueManager.getHandlerQueue(name);
    if (!queueProcessor) return;

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

  // Inline sync processing
  private async dispatchMapProjectionsInline({
    events,
    errors,
  }: {
    events: readonly EventType[];
    errors: Error[];
  }): Promise<void> {
    for (const event of events) {
      for (const [name, mapProj] of this.mapProjections) {
        await this.dispatchMapEventToHandlerInline({
          name,
          mapProj,
          event,
          errors,
        });
      }
    }
  }

  private async dispatchMapEventToHandlerInline({
    name,
    mapProj,
    event,
    errors,
  }: {
    name: string;
    mapProj: MapProjectionDefinition<any, EventType>;
    event: EventType;
    errors: Error[];
  }): Promise<void> {
    if (mapProj.options?.disabled) return;

    const disabled = await isComponentDisabled({
      featureFlagService: this.featureFlagService,
      aggregateType: this.aggregateType,
      componentType: "mapProjection",
      componentName: name,
      tenantId: event.tenantId,
      customKey: mapProj.options?.killSwitch?.customKey,
      logger: this.logger,
    });
    if (disabled) return;

    if (
      mapProj.eventTypes.length > 0 &&
      !mapProj.eventTypes.includes(event.type)
    ) {
      return;
    }

    try {
      await this.handleMapEvent({ name, mapProj, event });
    } catch (error) {
      handleError({
        error,
        category: categorizeError(error),
        logger: this.logger,
        context: {
          handlerName: name,
          eventType: event.type,
          aggregateId: String(event.aggregateId),
          tenantId: event.tenantId,
        },
      });
      errors.push(toError(error));
    }
  }

  private async dispatchToEventSubscribers(
    events: readonly EventType[],
  ): Promise<void> {
    const queued = this.queueManager.hasSubscriberQueues();
    const errors: Error[] = [];

    for (const [name, subscriber] of this.eventSubscribers) {
      if (subscriber.options?.disabled) continue;
      await this.dispatchEventsToSubscriber({
        name,
        subscriber,
        events,
        queued,
        errors,
      });
    }

    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `${errors.length} event subscriber(s) failed during dispatch`,
      );
    }
  }

  private async dispatchEventsToSubscriber({
    name,
    subscriber,
    events,
    queued,
    errors,
  }: {
    name: string;
    subscriber: EventSubscriberDefinition<EventType>;
    events: readonly EventType[];
    queued: boolean;
    errors: Error[];
  }): Promise<void> {
    const matching =
      subscriber.eventTypes.length === 0
        ? events
        : events.filter((event) => subscriber.eventTypes.includes(event.type));

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
    const killedByTenant = new Map<string, boolean>();
    const isKilledFor = async (tenantId: string): Promise<boolean> => {
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

    for (const event of matching) {
      try {
        await this.enqueueSubscriberEvent({
          name,
          subscriber,
          event,
          queued,
          isKilledFor,
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

  private async enqueueSubscriberEvent({
    name,
    subscriber,
    event,
    queued,
    isKilledFor,
  }: {
    name: string;
    subscriber: EventSubscriberDefinition<EventType>;
    event: EventType;
    queued: boolean;
    isKilledFor: (tenantId: string) => Promise<boolean>;
  }): Promise<void> {
    if (await isKilledFor(event.tenantId)) {
      // Counted, not skipped silently. A kill is permanent data loss for
      // this subscriber, and an operator has to be able to tell it apart
      // from a quiet subscriber — precisely when they are looking.
      incrementEsSubscriberEnqueueTotal({
        pipelineName: this.pipelineName,
        subscriberName: name,
        outcome: "killed",
      });
      return;
    }

    const enqueue = subscriber.options?.enqueue;

    // Enqueue-time filter (ADR-069 invariant 4): a declined event never
    // mints a job. A throw here is deliberately NOT caught as `false` —
    // it falls through to the catch below, so the failure is reported
    // rather than silently read as "not relevant". The routing path has
    // no retry (see EnqueueDispatchOptions), so the hook must be total:
    // if it throws, this subscriber loses its job for this event.
    if (enqueue?.filter && !enqueue.filter(event)) {
      incrementEsSubscriberEnqueueTotal({
        pipelineName: this.pipelineName,
        subscriberName: name,
        outcome: "filtered",
      });
      return;
    }

    // Claim-check staging (ADR-069): the subscriber may swap the staged
    // payload for a small reference event mirroring the source event's
    // scheduling identity. Total field-picks only — like the filter's, a
    // throw here is reported and counted `failed`, and permanently loses
    // this subscriber's job for this event. There is no routing retry:
    // eventSourcingService catches and logs the dispatch AggregateError
    // without rethrowing.
    //
    // Note the deploy-order dependency this creates: a reference is a
    // different event type, and a worker running the previous build
    // silently COMPLETES a job it cannot decode. See
    // `EnqueueDispatchOptions.stage` and ADR-069.
    const staged = enqueue?.stage ? (enqueue.stage(event) as EventType) : event;

    const queue = queued
      ? this.queueManager.getSubscriberQueue(name)
      : undefined;
    if (queue) {
      await queue.send(staged);
    } else {
      await this.handleSubscriber(subscriber, staged);
    }

    // Counted only once the handoff succeeded. A failed send throws to
    // the catch below, so a queue outage never inflates `staged` or
    // `referenced` — the outcome split stays an honest picture of what
    // the seam did.
    // A reference is a DIFFERENT event type by construction, which is
    // what the split means to an operator. Reference identity would count
    // a `stage` that rebuilt the same event as "referenced".
    incrementEsSubscriberEnqueueTotal({
      pipelineName: this.pipelineName,
      subscriberName: name,
      outcome: staged.type === event.type ? "staged" : "referenced",
    });
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

  private async processStateProjectionEvents({
    projectionName,
    projection,
    events,
    context,
  }: {
    projectionName: string;
    projection: StateProjectionDefinition<any, EventType>;
    events: EventType[];
    context: EventStoreReadContext<EventType>;
  }): Promise<void> {
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

        const toApply = await this.filterReplaySkipped({
          projectionName,
          events,
        });
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
          onComplete: (ms) =>
            this.recordStateProjectionMetrics({
              projectionName,
              status: "completed",
              durationMs: ms,
              eventCount: toApply.length,
            }),
          onFail: (ms) =>
            this.recordStateProjectionMetrics({
              projectionName,
              status: "failed",
              durationMs: ms,
              eventCount: toApply.length,
            }),
        });
      },
    );
  }

  private async filterReplaySkipped({
    projectionName,
    events,
  }: {
    projectionName: string;
    events: EventType[];
  }): Promise<EventType[]> {
    if (!this.replayMarkerChecker) return events;

    const kept: EventType[] = [];
    for (const event of events) {
      const decision = await this.replayMarkerChecker.check(
        projectionName,
        event,
      );
      if (decision !== "skip") kept.push(event);
    }
    return kept;
  }

  private recordStateProjectionMetrics({
    projectionName,
    status,
    durationMs,
    eventCount,
  }: {
    projectionName: string;
    status: "completed" | "failed";
    durationMs: number;
    eventCount: number;
  }): void {
    incrementEsProjectionTotal({
      pipelineName: this.pipelineName,
      projectionKind: "state",
      projectionName,
      status,
    });
    observeEsProjectionDuration({
      pipelineName: this.pipelineName,
      projectionKind: "state",
      projectionName,
      durationMs,
    });
    if (durationMs >= SLOW_PROJECTION_OPERATION_MS) {
      this.logger.warn(
        {
          pipelineName: this.pipelineName,
          projectionKind: "state",
          projectionName,
          eventCount,
          durationMs: Math.round(durationMs),
        },
        status === "completed"
          ? "State projection execution is slow"
          : "Failed state projection execution was slow",
      );
    }
  }

  /**
   * Processes a single event for a fold projection (incremental).
   * The fold state in the store serves as the checkpoint — no separate checkpoint tracking needed.
   */
  private async processFoldProjectionEvent({
    projectionName,
    fold,
    event,
    context,
  }: {
    projectionName: string;
    fold: FoldProjectionDefinition<any, EventType>;
    event: EventType;
    context: EventStoreReadContext<EventType>;
  }): Promise<void> {
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

        // After fold succeeds, dispatch to reactors for this fold. The fold
        // state is durable by this point, so a throw from here redelivers
        // events the store already contains.
        await this.dispatchReactorsAfterStore({
          projectionName,
          events: [event],
          foldState,
        });
      },
    );
  }

  /**
   * Dispatches a fold's reactors once its state is already durable.
   *
   * Anything that throws from here fails the job without un-writing the state,
   * so the queue redelivers events the store already holds — see
   * {@link recordPostStoreFailure}. Shared by the single-event and batch paths
   * so the two cannot drift on the exact path this counter measures.
   */
  private async dispatchReactorsAfterStore({
    projectionName,
    events,
    foldState,
  }: {
    projectionName: string;
    events: EventType[];
    foldState: unknown;
  }): Promise<void> {
    const reactors = this.reactorsForFold.get(projectionName);
    if (!reactors || reactors.length === 0) return;

    try {
      await this.dispatchToReactors({
        foldName: projectionName,
        reactors,
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
   * Records a failure that happened after the fold's state was durably stored.
   *
   * Distinct from a plain fold failure: the store already holds this batch, so
   * the retry re-applies it. Accumulating folds (spanCount + 1, cost sums, id
   * appends) double-count as a result — nothing on this path deduplicates by
   * event id.
   *
   * Logged at warn with the aggregate and event ids so the affected traces can
   * be identified and reconciled after an incident — the metric says how often,
   * the log says which.
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
   * Processes a batch of same-aggregate events for a fold projection in a single
   * load/apply/store cycle (see FoldProjectionExecutor.executeBatch). Used by the
   * GroupQueue's coalescing path when a group is backed up. All events share the
   * aggregate (and tenant), so kill-switch and store key are resolved once.
   *
   * Reactors fire once with the final folded state (using the last event), which
   * is the correct coalesced behavior for the trace's debounced reactors.
   */
  private async processFoldProjectionBatch({
    projectionName,
    fold,
    events,
    context,
  }: {
    projectionName: string;
    fold: FoldProjectionDefinition<any, EventType>;
    events: EventType[];
    context: EventStoreReadContext<EventType>;
  }): Promise<void> {
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
        const replayed = await this.filterReplaySkipped({
          projectionName,
          events,
        });
        if (replayed.length === 0) return;

        // Apply (and dispatch reactors) in occurredAt order — the same order
        // executeBatch folds in — so reactor metadata and the final state are
        // consistent regardless of the order events were drained/dispatched in.
        const toApply = [...replayed].sort(compareByOccurredAt);

        const first = toApply[0]!;
        const key = fold.key ? fold.key(first) : undefined;
        const storeContext = await this.buildStoreContext(
          first,
          key,
          context.deliveryAttempt,
        );

        const foldState = await withMetrics({
          fn: () => this.foldExecutor.executeBatch(fold, toApply, storeContext),
          onComplete: (ms) =>
            this.recordFoldProjectionMetrics({
              projectionName,
              status: "completed",
              durationMs: ms,
            }),
          onFail: (ms) =>
            this.recordFoldProjectionMetrics({
              projectionName,
              status: "failed",
              durationMs: ms,
            }),
        });

        // Dispatch reactors for the whole batch, with the final fold state.
        // Per-span reactors must see every event: customEvaluationSync reads
        // event.data.span to extract embedded SDK evals, and its makeJobId
        // carries the event id, so it is dispatched once per event. Reactors
        // keyed on the aggregate (broadcast, metadata, alerts) would be squashed
        // to one job by the queue's dedup anyway, so dispatchToReactors collapses
        // them here instead of paying N serialize+gzip+blob round-trips to reach
        // the same state. See ProjectionRouter.collapseByJobId.
        //
        // A post-store failure is worse here than on the single-event path: the
        // whole coalesced batch is re-applied, so one failure can double-count
        // up to DEFAULT_FOLD_COALESCE_MAX_BATCH events against one aggregate.
        await this.dispatchReactorsAfterStore({
          projectionName,
          events: toApply,
          foldState,
        });
      },
    );
  }

  private recordFoldProjectionMetrics({
    projectionName,
    status,
    durationMs,
  }: {
    projectionName: string;
    status: "completed" | "failed";
    durationMs: number;
  }): void {
    incrementEsFoldProjectionTotal({
      pipelineName: this.pipelineName,
      projectionName,
      status,
    });
    observeEsFoldProjectionDuration({
      pipelineName: this.pipelineName,
      projectionName,
      durationMs,
    });
  }

  /**
   * Builds the context a reactor receives. Used for both shouldReact and
   * handle so the predicate can never see a different shape than the handler.
   */
  private buildReactorContext({
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
   * Evaluates a reactor's optional shouldReact predicate. Fails open: a
   * thrown predicate is logged and treated as true so a predicate bug can
   * never drop a side effect (worst case is one redundant job).
   */
  private reactorShouldReact(
    reactor: ReactorDefinition<EventType>,
    event: EventType,
    foldState: unknown,
  ): boolean {
    if (!reactor.shouldReact) return true;

    try {
      return reactor.shouldReact(
        event,
        this.buildReactorContext({ event, foldState }),
      );
    } catch (error) {
      this.logger.error(
        {
          reactorName: reactor.name,
          eventId: event.id,
          eventType: event.type,
          tenantId: event.tenantId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Reactor shouldReact predicate threw — failing open and dispatching",
      );
      return true;
    }
  }

  /**
   * The events a reactor must actually be sent for, out of a coalesced batch.
   *
   * A reactor's `makeJobId` IS its collapse key: the queue dedups on it, so N
   * sends carrying the same job id leave exactly one job behind — the last one,
   * since staging replaces a squashed duplicate. Reactors keyed on the aggregate
   * (`eval-trigger:${tenantId}:${aggregateId}`, `trace-update:…`) therefore
   * produce one job no matter how many events a backed-up group drains.
   *
   * Sending all N anyway is not free: each send serializes `{event, foldState}`,
   * gzips it, and — once past the envelope's inline ceiling — writes a
   * content-addressed blob into Redis that the ensuing dedup squash immediately
   * reclaims. On a 10k-span trace that was ~99 discarded round-trips per drained
   * batch, per reactor. Collapsing here reaches the same queue state by the same
   * rule the queue itself would have applied, without the churn.
   *
   * Reactors keyed per event (`…:${event.id}`) collapse to nothing and are
   * dispatched for every event, as are reactors with no job id at all.
   *
   * Each delivery carries its own state because a map batch has no single one:
   * a fold hands the same accumulated state to every event, but a map produces
   * a separate record per event, and the survivor must keep the record it was
   * actually paired with.
   */
  private collapseByJobId({
    reactor,
    deliveries,
  }: {
    reactor: ReactorDefinition<EventType>;
    deliveries: ReactorDelivery<EventType>[];
  }): ReactorDelivery<EventType>[] {
    const makeJobId = reactor.options?.makeJobId;
    if (!makeJobId || deliveries.length < 2) return deliveries;

    try {
      // Keep the LAST delivery per job id — the one the queue's dedup squash
      // would have left behind (STAGE_LUA overwrites the stored value when
      // `shouldReplace`, which every reactor here defaults to).
      //
      // A Map alone would order the survivors by each job id's FIRST
      // occurrence while holding its last value, so a batch carrying two job
      // ids could dispatch a later event before an earlier one. Re-sort by the
      // surviving delivery's position so dispatch really is in occurredAt
      // order — deliveries arrive sorted, so the index IS that order.
      const lastIndexPerJobId = new Map<string, number>();
      deliveries.forEach((delivery, index) => {
        lastIndexPerJobId.set(makeJobId(delivery), index);
      });
      const survivors = [...lastIndexPerJobId.values()].sort((a, b) => a - b);
      if (survivors.length === deliveries.length) return deliveries;

      incrementEsReactorCollapsedTotal(
        this.pipelineName,
        reactor.name,
        deliveries.length - survivors.length,
      );
      return survivors.map((index) => deliveries[index]!);
    } catch (error) {
      // Fail open, like `shouldReact`: a throwing job-id function must never
      // drop a side effect. Worst case is the un-collapsed fan-out we had before.
      this.logger.error(
        {
          reactorName: reactor.name,
          eventCount: deliveries.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Reactor makeJobId threw while collapsing a batch — dispatching every event",
      );
      return deliveries;
    }
  }

  /**
   * Dispatches a coalesced batch of same-aggregate events to reactors registered
   * on a fold projection. In queued mode, sends to reactor queues. In inline
   * mode, calls directly. A single event is just a batch of one.
   *
   * Events are filtered by `shouldReact` BEFORE they are collapsed, so a reactor
   * keyed on the aggregate receives the last event it actually cared about
   * rather than the last event in the batch.
   */
  private async dispatchToReactors({
    foldName,
    reactors,
    deliveries,
  }: {
    foldName: string;
    reactors: ReactorDefinition<EventType>[];
    deliveries: ReactorDelivery<EventType>[];
  }): Promise<void> {
    const errors: Error[] = [];

    for (const reactor of reactors) {
      if (reactor.options?.disabled) continue;
      if (this.isReactorExcluded(reactor)) continue;

      const relevant = this.filterRelevantDeliveries({ reactor, deliveries });
      if (relevant.length === 0) continue;

      for (const { event, foldState } of this.collapseByJobId({
        reactor,
        deliveries: relevant,
      })) {
        await this.dispatchOneToReactor({
          foldName,
          reactor,
          event,
          foldState,
          errors,
        });
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `${errors.length} reactor(s) failed during dispatch`,
      );
    }
  }

  private filterRelevantDeliveries({
    reactor,
    deliveries,
  }: {
    reactor: ReactorDefinition<EventType>;
    deliveries: ReactorDelivery<EventType>[];
  }): ReactorDelivery<EventType>[] {
    const relevant: ReactorDelivery<EventType>[] = [];
    for (const delivery of deliveries) {
      if (
        this.reactorShouldReact(reactor, delivery.event, delivery.foldState)
      ) {
        relevant.push(delivery);
      } else {
        incrementEsReactorTotal(this.pipelineName, reactor.name, "skipped");
      }
    }
    return relevant;
  }

  /**
   * Sends one event to one reactor, collecting rather than throwing failures so
   * a single bad reactor can't skip the ones after it.
   */
  private async dispatchOneToReactor({
    foldName,
    reactor,
    event,
    foldState,
    errors,
  }: {
    foldName: string;
    reactor: ReactorDefinition<EventType>;
    event: EventType;
    foldState: unknown;
    errors: Error[];
  }): Promise<void> {
    const hasReactorQueues = this.queueManager.hasReactorQueues();
    const queueProcessor = hasReactorQueues
      ? this.queueManager.getReactorQueue(reactor.name)
      : undefined;

    if (queueProcessor) {
      try {
        await queueProcessor.send({ event, foldState });
      } catch (error) {
        this.logger.error(
          {
            reactorName: reactor.name,
            foldName,
            eventId: event.id,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to dispatch event to reactor queue",
        );
        errors.push(toError(error));
      }
      return;
    }

    if (hasReactorQueues) {
      // Queue expected but not found — fall back to inline execution
      this.logger.warn(
        {
          reactorName: reactor.name,
          foldName,
          eventId: event.id,
        },
        "Reactor queue not found, falling back to inline execution",
      );
      await this.runReactorInline({
        foldName,
        reactor,
        event,
        foldState,
        errors,
        failureMessage: "Reactor failed during inline fallback execution",
      });
      return;
    }

    // Inline mode: call reactor directly
    await this.runReactorInline({
      foldName,
      reactor,
      event,
      foldState,
      errors,
      failureMessage:
        "Reactor failed during inline execution — fold state persisted in CH but reactor side-effect (e.g. ES sync) was lost",
    });
  }

  private async runReactorInline({
    foldName,
    reactor,
    event,
    foldState,
    errors,
    failureMessage,
  }: {
    foldName: string;
    reactor: ReactorDefinition<EventType>;
    event: EventType;
    foldState: unknown;
    errors: Error[];
    failureMessage: string;
  }): Promise<void> {
    try {
      await withMetrics({
        fn: () =>
          reactor.handle(event, this.buildReactorContext({ event, foldState })),
        onComplete: (ms) => {
          incrementEsReactorTotal(this.pipelineName, reactor.name, "completed");
          observeEsReactorDuration(this.pipelineName, reactor.name, ms);
        },
        onFail: (ms) => {
          incrementEsReactorTotal(this.pipelineName, reactor.name, "failed");
          observeEsReactorDuration(this.pipelineName, reactor.name, ms);
        },
      });
    } catch (error) {
      this.logger.error(
        {
          reactorName: reactor.name,
          foldName,
          eventId: event.id,
          eventType: event.type,
          aggregateId: String(event.aggregateId),
          tenantId: event.tenantId,
          error: error instanceof Error ? error.message : String(error),
        },
        failureMessage,
      );
      errors.push(toError(error));
    }
  }

  /**
   * Gets a fold projection by name for a given aggregate.
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
    const projection = await this.getProjectionByName({
      projectionName,
      aggregateId,
      context,
      options,
    });
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

  /** Returns true if the reactor's runIn filter excludes the current processRole. */
  private isReactorExcluded(reactor: ReactorDefinition<EventType>): boolean {
    return !roleSatisfiesRunIn({
      runIn: reactor.options?.runIn,
      processRole: this.processRole,
    });
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
