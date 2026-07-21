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
import type { EventSubscriberDefinition } from "../subscribers/eventSubscriber.types";
import { EventUtils } from "../utils/event.utils";
import { isComponentDisabled } from "../utils/killSwitch";
import type { FoldProjectionDefinition } from "./foldProjection.types";
import { FoldProjectionExecutor } from "./foldProjectionExecutor";
import type { MapProjectionDefinition } from "./mapProjection.types";
import { MapProjectionExecutor } from "./mapProjectionExecutor";
import type { StateProjectionDefinition } from "./stateProjection.types";
import { StateProjectionExecutor } from "./stateProjectionExecutor";
import type { ProjectionStoreContext } from "./projectionStoreContext";
import type { ReplayMarkerChecker } from "./replayMarkerCheck";

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
const DEFAULT_FOLD_COALESCE_MAX_BATCH = 500;
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

  constructor(
    private readonly aggregateType: AggregateType,
    private readonly pipelineName: string,
    private readonly queueManager: QueueManager<EventType>,
    private readonly featureFlagService?: FeatureFlagServiceInterface,
    private readonly processRole?: ProcessRole,
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
    this.foldProjections.set(projection.name, projection);
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

    const reactorDefs: Record<
      string,
      {
        name: string;
        parentProjection: string;
        parentType: "fold" | "map";
        handler: {
          handle: (payload: {
            event: EventType;
            foldState: unknown;
          }) => Promise<void>;
        };
        groupKeyFn?: (payload: {
          event: EventType;
          foldState: unknown;
        }) => string;
        options?: {
          killSwitch?: KillSwitchOptions;
          disabled?: boolean;
          delay?: number;
          deduplication?: DeduplicationStrategy<{
            event: EventType;
            foldState: unknown;
          }>;
        };
      }
    > = {};

    for (const [foldName, reactors] of this.reactorsForFold) {
      for (const reactor of reactors) {
        if (this.isReactorExcluded(reactor)) continue;
        reactorDefs[reactor.name] = {
          name: reactor.name,
          parentProjection: foldName,
          parentType: "fold" as const,
          handler: {
            handle: async (payload: {
              event: EventType;
              foldState: unknown;
            }) => {
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
                ? {
                    makeId: reactor.options.makeJobId,
                    ttlMs: reactor.options.ttl,
                  }
                : undefined),
          },
        };
      }
    }

    for (const [mapName, reactors] of this.reactorsForMap) {
      for (const reactor of reactors) {
        if (this.isReactorExcluded(reactor)) continue;
        reactorDefs[reactor.name] = {
          name: reactor.name,
          parentProjection: mapName,
          parentType: "map" as const,
          handler: {
            handle: async (payload: {
              event: EventType;
              foldState: unknown;
            }) => {
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
                ? {
                    makeId: reactor.options.makeJobId,
                    ttlMs: reactor.options.ttl,
                  }
                : undefined),
          },
        };
      }
    }

    this.queueManager.initializeReactorQueues(
      reactorDefs,
      async (reactorName, payload, _context) => {
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
            incrementEsReactorTotal(
              this.pipelineName,
              reactorName,
              "completed",
            );
            observeEsReactorDuration(this.pipelineName, reactorName, ms);
          },
          onFail: (ms) => {
            incrementEsReactorTotal(this.pipelineName, reactorName, "failed");
            observeEsReactorDuration(this.pipelineName, reactorName, ms);
          },
        });
      },
    );
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
      async (projectionName, event) => {
        const projection = this.stateProjections.get(projectionName);
        if (!projection) {
          throw new ConfigurationError(
            "ProjectionRouter",
            `Projection "${projectionName}" not found`,
            { projectionName },
          );
        }
        await this.processStateProjectionEvents(projectionName, projection, [
          event,
        ]);
      },
      async (projectionName, events) => {
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

    this.queueManager.initializeProjectionQueues(
      projectionDefs,
      async (projectionName, triggerEvent, _context) => {
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
          { tenantId: triggerEvent.tenantId },
        );
      },
      async (projectionName, events, _context) => {
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

            // Dispatch to map reactors after map execute succeeds
            const mapReactors = this.reactorsForMap.get(name);
            if (record !== null && mapReactors && mapReactors.length > 0) {
              await this.dispatchToReactors({
                foldName: name,
                reactors: mapReactors,
                events: [event],
                foldState: record,
              });
            }
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

            const firstContext = await this.buildStoreContext(toApply[0]!);
            const contexts = toApply.map((event) => ({
              ...firstContext,
              aggregateId: String(event.aggregateId),
              // Per-event tenantId keeps the executor's cross-tenant guard honest.
              tenantId: event.tenantId,
            }));
            const mapped = await withMetrics({
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

            const mapReactors = this.reactorsForMap.get(name);
            if (mapReactors && mapReactors.length > 0) {
              for (const { event, record } of mapped) {
                await this.dispatchToReactors({
                  foldName: name,
                  reactors: mapReactors,
                  events: [event],
                  foldState: record,
                });
              }
            }
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
            await this.dispatchToStateProjections(events);
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
          await this.processStateProjectionEvents(name, projection, [event]);
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

            // Dispatch to map reactors after map execute succeeds
            const mapReactors = this.reactorsForMap.get(name);
            if (record !== null && mapReactors && mapReactors.length > 0) {
              await this.dispatchToReactors({
                foldName: name,
                reactors: mapReactors,
                events: [event],
                foldState: record,
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

      for (const event of matching) {
        try {
          if (queued) {
            const queue = this.queueManager.getSubscriberQueue(name);
            if (queue) {
              await queue.send(event);
              continue;
            }
          }
          await this.handleSubscriber(subscriber, event);
        } catch (error) {
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
        const storeContext = await this.buildStoreContext(toApply[0]!, key);
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
        const storeContext = await this.buildStoreContext(event, key);

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

        // After fold succeeds, dispatch to reactors for this fold.
        //
        // The fold state is durable by this point. Anything that throws from
        // here on fails the job without un-writing it, so the queue redelivers
        // events the store already contains — see recordPostStoreFailure.
        const reactors = this.reactorsForFold.get(projectionName);
        if (reactors && reactors.length > 0) {
          try {
            await this.dispatchToReactors({
              foldName: projectionName,
              reactors,
              events: [event],
              foldState,
            });
          } catch (error) {
            this.recordPostStoreFailure({
              projectionName,
              stage: "reactor_dispatch",
              events: [event],
              error,
            });
            throw error;
          }
        }
      },
    );
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

        // Apply (and dispatch reactors) in occurredAt order — the same order
        // executeBatch folds in — so reactor metadata and the final state are
        // consistent regardless of the order events were drained/dispatched in.
        toApply = [...toApply].sort(
          (a, b) =>
            (((a as Record<string, unknown>).occurredAt as number) ?? 0) -
            (((b as Record<string, unknown>).occurredAt as number) ?? 0),
        );

        const first = toApply[0]!;
        const key = fold.key ? fold.key(first) : undefined;
        const storeContext = await this.buildStoreContext(first, key);

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

        // Dispatch reactors for the whole batch, with the final fold state.
        // Per-span reactors must see every event: customEvaluationSync reads
        // event.data.span to extract embedded SDK evals, and its makeJobId
        // carries the event id, so it is dispatched once per event. Reactors
        // keyed on the aggregate (broadcast, metadata, alerts) would be squashed
        // to one job by the queue's dedup anyway, so dispatchToReactors collapses
        // them here instead of paying N serialize+gzip+blob round-trips to reach
        // the same state. See ProjectionRouter.collapseByJobId.
        const reactors = this.reactorsForFold.get(projectionName);
        if (reactors && reactors.length > 0) {
          try {
            await this.dispatchToReactors({
              foldName: projectionName,
              reactors,
              events: toApply,
              foldState,
            });
          } catch (error) {
            // Worse here than on the single-event path: the whole coalesced
            // batch is re-applied, so one failure can double-count up to
            // DEFAULT_FOLD_COALESCE_MAX_BATCH events against one aggregate.
            this.recordPostStoreFailure({
              projectionName,
              stage: "reactor_dispatch",
              events: toApply,
              error,
            });
            throw error;
          }
        }
      },
    );
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
   */
  private collapseByJobId({
    reactor,
    events,
    foldState,
  }: {
    reactor: ReactorDefinition<EventType>;
    events: EventType[];
    foldState: unknown;
  }): EventType[] {
    const makeJobId = reactor.options?.makeJobId;
    if (!makeJobId || events.length < 2) return events;

    try {
      // Keep the LAST event per job id — the one the queue's dedup squash would
      // have left behind (STAGE_LUA overwrites the stored value when
      // `shouldReplace`, which every reactor here defaults to).
      //
      // A Map alone would order the survivors by each job id's FIRST
      // occurrence while holding its last value, so a batch carrying two job
      // ids could dispatch a later event before an earlier one. Re-sort by the
      // surviving event's position so dispatch really is in occurredAt order —
      // `events` arrives sorted, so the index IS that order.
      const lastIndexPerJobId = new Map<string, number>();
      events.forEach((event, index) => {
        lastIndexPerJobId.set(makeJobId({ event, foldState }), index);
      });
      const survivors = [...lastIndexPerJobId.values()].sort((a, b) => a - b);
      if (survivors.length === events.length) return events;

      incrementEsReactorCollapsedTotal(
        this.pipelineName,
        reactor.name,
        events.length - survivors.length,
      );
      return survivors.map((index) => events[index]!);
    } catch (error) {
      // Fail open, like `shouldReact`: a throwing job-id function must never
      // drop a side effect. Worst case is the un-collapsed fan-out we had before.
      this.logger.error(
        {
          reactorName: reactor.name,
          eventCount: events.length,
          error: error instanceof Error ? error.message : String(error),
        },
        "Reactor makeJobId threw while collapsing a batch — dispatching every event",
      );
      return events;
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
    events,
    foldState,
  }: {
    foldName: string;
    reactors: ReactorDefinition<EventType>[];
    events: EventType[];
    foldState: unknown;
  }): Promise<void> {
    const errors: Error[] = [];

    for (const reactor of reactors) {
      if (reactor.options?.disabled) continue;
      if (this.isReactorExcluded(reactor)) continue;

      const relevant: EventType[] = [];
      for (const event of events) {
        if (this.reactorShouldReact(reactor, event, foldState)) {
          relevant.push(event);
        } else {
          incrementEsReactorTotal(this.pipelineName, reactor.name, "skipped");
        }
      }
      if (relevant.length === 0) continue;

      for (const event of this.collapseByJobId({
        reactor,
        events: relevant,
        foldState,
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

    if (hasReactorQueues) {
      const queueProcessor = this.queueManager.getReactorQueue(reactor.name);
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
      } else {
        // Queue expected but not found — fall back to inline execution
        this.logger.warn(
          {
            reactorName: reactor.name,
            foldName,
            eventId: event.id,
          },
          "Reactor queue not found, falling back to inline execution",
        );
        try {
          await withMetrics({
            fn: () =>
              reactor.handle(
                event,
                this.buildReactorContext({ event, foldState }),
              ),
            onComplete: (ms) => {
              incrementEsReactorTotal(
                this.pipelineName,
                reactor.name,
                "completed",
              );
              observeEsReactorDuration(this.pipelineName, reactor.name, ms);
            },
            onFail: (ms) => {
              incrementEsReactorTotal(
                this.pipelineName,
                reactor.name,
                "failed",
              );
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
            "Reactor failed during inline fallback execution",
          );
          errors.push(toError(error));
        }
      }
    } else {
      // Inline mode: call reactor directly
      try {
        await withMetrics({
          fn: () =>
            reactor.handle(
              event,
              this.buildReactorContext({ event, foldState }),
            ),
          onComplete: (ms) => {
            incrementEsReactorTotal(
              this.pipelineName,
              reactor.name,
              "completed",
            );
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
          "Reactor failed during inline execution — fold state persisted in CH but reactor side-effect (e.g. ES sync) was lost",
        );
        errors.push(toError(error));
      }
    }
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
  ): Promise<ProjectionStoreContext> {
    const retentionPolicy = await this.resolveRetention(event.tenantId);
    return {
      aggregateId: String(event.aggregateId),
      tenantId: event.tenantId,
      ...(key !== undefined ? { key } : {}),
      retentionPolicy,
    };
  }
}
