import type { FoldStateCache } from "@langwatch/clickhouse";
import {
  type BuiltPipeline,
  type BuiltProcessManager,
  type Clock,
  createProcessRuntime,
  type EnginePorts,
  EventSourcingError,
  isDispatchError,
  type LaneExecution,
  type LaneExecutors,
  type Metrics,
  memoryEventLog,
  memoryOutbox,
  memoryProcessStore,
  memoryQueue,
  memorySpool,
  type Outbox,
  type OutboxRow,
  type ProcessContext,
  type ProcessInstanceKey,
  type ProcessStore,
  type Registry,
  type StoreContext,
  type StoredState,
  systemClock,
  toDispatchError,
} from "@langwatch/event-sourcing";
import { redisBlobSpool, redisLaneQueue } from "@langwatch/groupqueue";
import { createLogger } from "@langwatch/observability";
import type { Redis } from "ioredis";

export interface EngineInfra {
  /** Present only where the deployment runs consumers against real Redis —
   * absent gives the pure in-memory queue/spool ADR-110 decision 4 requires
   * to stay reachable. */
  readonly redis?: Redis;
  /** The durable log. `clickhouseEventLog` from `@langwatch/clickhouse` is the
   * production implementation; absent leaves the in-memory one ADR-110
   * decision 4 requires to stay reachable. */
  readonly eventLog?: EnginePorts["eventLog"];
  /** `prismaProcessStore` from `./adapters/prismaProcessStore` in production. */
  readonly processStore?: ProcessStore;
  /** `prismaOutbox` from `./adapters/prismaOutbox` in production. */
  readonly outbox?: Outbox;
  readonly clock?: Clock;
  readonly metrics?: Metrics;
  readonly enabled?: EnginePorts["enabled"];
  /** Redis-enforced, global across pods — 0 (default) leaves it off. Passed
   * to `redisLaneQueue`; the in-memory queue enforces no cap at all. */
  readonly tenantSoftCap?: number;
}

/**
 * Every port the engine needs. With no `redis`, everything is in memory —
 * the dev/test default, and what proves ADR-110 decision 4 ("no ClickHouse,
 * no Redis, no Postgres"). With `redis`, the queue and spool are the real
 * Redis substrate; the event log, process store and outbox stay in memory
 * until their own adapters land, since nothing else built them yet.
 */
export function buildEnginePorts(infra: EngineInfra = {}): EnginePorts {
  const clock = infra.clock ?? systemClock();
  const spool = infra.redis ? redisBlobSpool(infra.redis) : memorySpool();
  const queue = infra.redis
    ? redisLaneQueue(infra.redis, spool, { tenantSoftCap: infra.tenantSoftCap })
    : memoryQueue(clock);

  return {
    eventLog: infra.eventLog ?? memoryEventLog(),
    queue,
    spool,
    processStore: infra.processStore ?? memoryProcessStore(),
    outbox: infra.outbox ?? memoryOutbox(clock),
    clock,
    metrics: infra.metrics,
    enabled: infra.enabled,
  };
}

/** Every read is a miss — the in-process map is fine when there is no fleet
 * to share a tier with (no Redis). */
export function inMemoryFoldStateCache<State>(): FoldStateCache<State> {
  const cache = new Map<string, StoredState<State>>();
  return {
    get: async (key) => cache.get(key) ?? null,
    set: async (key, stored) => {
      cache.set(key, stored);
    },
    delete: async (key) => {
      cache.delete(key);
    },
  };
}

/** The shared warm tier when a fleet is running behind Redis, keyed by
 * tenant so two tenants' folds never collide on a bare fold key — the store
 * itself passes only the fold's own key, never tenant-scoped (ADR-098). */
export function redisFoldStateCache<State>(args: {
  readonly redis: Redis;
  readonly keyPrefix: string;
}): FoldStateCache<State> {
  const redisKey = (key: string, context: StoreContext) =>
    `foldcache:${args.keyPrefix}:${context.tenantId}:${key}`;
  return {
    async get(key, context) {
      const raw = await args.redis.get(redisKey(key, context));
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as StoredState<State>;
      } catch {
        return null;
      }
    },
    async set(key, stored, context) {
      await args.redis.set(redisKey(key, context), JSON.stringify(stored));
    },
    async delete(key, context) {
      await args.redis.del(redisKey(key, context));
    },
  };
}

function memberFor(execution: LaneExecution) {
  return {
    fold: execution.pipeline.folds[execution.name],
    map: execution.pipeline.maps[execution.name],
    subscriber: execution.pipeline.subscribers[execution.name],
    processManager: execution.pipeline.processManagers[execution.name],
  };
}

function findProcessManager(
  registry: Pick<Registry, "all">,
  processName: string,
):
  | { readonly pipeline: BuiltPipeline; readonly pm: BuiltProcessManager }
  | undefined {
  for (const { pipeline } of registry.all()) {
    const pm = pipeline.processManagers[processName];
    if (pm) return { pipeline, pm };
  }
  return undefined;
}

async function stageIntents(args: {
  readonly outbox: Outbox;
  readonly pm: BuiltProcessManager;
  readonly tenantId: string;
  readonly intents: readonly {
    readonly type: string;
    readonly payload: unknown;
  }[];
}): Promise<void> {
  if (args.intents.length === 0) return;
  const rows = args.intents.map((intent) => {
    const def = args.pm.intents[intent.type];
    if (!def) {
      throw new EventSourcingError(
        `process manager "${args.pm.name}" evolved an intent "${intent.type}" it never declared`,
        { processManager: args.pm.name, intent: intent.type },
      );
    }
    return {
      intentType: `${args.pm.name}/${intent.type}`,
      messageKey: def.messageKey(intent.payload),
      tenantId: args.tenantId,
      payload: JSON.stringify(intent.payload),
    };
  });
  await args.outbox.stage(rows);
}

/**
 * Runs one process manager's batch as a single left-fold (ADR-108 §8: one
 * emission, not N). An event whose type has no declared handler contributes
 * nothing — state, intents and the armed wake stay exactly as the last event
 * that did run left them.
 */
async function runProcessManager(
  execution: LaneExecution,
  deps: {
    readonly processStore: ProcessStore;
    readonly outbox: Outbox;
    readonly clock: Clock;
  },
): Promise<void> {
  const pm = memberFor(execution).processManager;
  if (!pm) {
    throw new EventSourcingError(
      `no process manager named "${execution.name}" on pipeline "${execution.pipeline.name}"`,
      { pipeline: execution.pipeline.name, name: execution.name },
    );
  }

  const key: ProcessInstanceKey = {
    processName: pm.name,
    projectId: execution.tenantId,
    processKey: execution.aggregateId,
  };
  const stored = await deps.processStore.load(key);
  if (stored !== null && stored.stateVersion !== pm.stateVersion) {
    // Never silently overwritten (same rule as a fold's undecodable row) — an
    // incompatible row fails the delivery so an operator sees it, rather than
    // resetting an in-flight process instance to `init()`.
    throw new EventSourcingError(
      `process manager "${pm.name}" cannot resume instance "${execution.aggregateId}": stored state version "${stored.stateVersion}" does not match "${pm.stateVersion}"`,
      { processManager: pm.name, processKey: execution.aggregateId },
    );
  }
  const state =
    stored === null ? pm.init() : pm.stateSchema.parse(stored.state);
  const expectedRevision = stored?.revision ?? 0;

  let current = state;
  let ranAtLeastOnce = false;
  let nextWakeAt: number | null = null;
  const intents: { readonly type: string; readonly payload: unknown }[] = [];

  for (const event of execution.events) {
    const ctx: ProcessContext = {
      now: deps.clock.now(),
      tenantId: execution.tenantId,
      processKey: execution.aggregateId,
    };
    const step = pm.evolve(current, event, ctx);
    if (step === null) continue;
    current = step.state;
    nextWakeAt = step.nextWakeAt;
    intents.push(...step.intents);
    ranAtLeastOnce = true;
  }

  if (!ranAtLeastOnce) return;

  await deps.processStore.save({
    key,
    tenantId: execution.tenantId,
    state: current,
    stateVersion: pm.stateVersion,
    expectedRevision,
    nextWakeAt,
  });
  await stageIntents({
    outbox: deps.outbox,
    pm,
    tenantId: execution.tenantId,
    intents,
  });
}

/**
 * The four lane executors (ADR-108 §1's consumer collaborator) — resolving a
 * lane down to the concrete built member and running it is the composition
 * root's job, not the package's (`consumer.ts`'s own docblock).
 */
export function createGenericLaneExecutors(deps: {
  readonly processStore: ProcessStore;
  readonly outbox: Outbox;
  readonly clock: Clock;
}): LaneExecutors {
  return {
    async fold(execution) {
      const fold = memberFor(execution).fold;
      if (!fold) {
        throw new EventSourcingError(
          `no fold named "${execution.name}" on pipeline "${execution.pipeline.name}"`,
          {
            pipeline: execution.pipeline.name,
            name: execution.name,
          },
        );
      }
      await fold.apply({
        key: execution.aggregateId,
        tenantId: execution.tenantId,
        events: execution.events,
      });
    },

    async map(execution) {
      const map = memberFor(execution).map;
      if (!map) {
        throw new EventSourcingError(
          `no map named "${execution.name}" on pipeline "${execution.pipeline.name}"`,
          {
            pipeline: execution.pipeline.name,
            name: execution.name,
          },
        );
      }
      await map.apply({
        tenantId: execution.tenantId,
        events: execution.events,
      });
    },

    async subscriber(execution) {
      const subscriber = memberFor(execution).subscriber;
      if (!subscriber) {
        throw new EventSourcingError(
          `no subscriber named "${execution.name}" on pipeline "${execution.pipeline.name}"`,
          {
            pipeline: execution.pipeline.name,
            name: execution.name,
          },
        );
      }
      for (const event of execution.events) {
        await subscriber.handle(event, {
          now: deps.clock.now(),
          tenantId: execution.tenantId,
        });
      }
    },

    processManager: (execution) => runProcessManager(execution, deps),
  };
}

const OUTBOX_CLAIM_LIMIT = 50;
const OUTBOX_LEASE_MS = 30_000;
const DEFAULT_OUTBOX_RETRY_MS = 5_000;
const POLL_INTERVAL_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves one outbox row's declared intent, delivers it, and settles or
 * fails the row by the classified outcome. */
async function deliverOutboxRow(
  row: OutboxRow,
  deps: {
    readonly outbox: Outbox;
    readonly registry: Pick<Registry, "all">;
    readonly clock: Clock;
  },
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  const [processName, intentName] = row.intentType.split("/");
  const found =
    processName && intentName
      ? findProcessManager(deps.registry, processName)
      : undefined;
  const def = intentName ? found?.pm.intents[intentName] : undefined;
  if (!def) {
    logger.error(
      { intentType: row.intentType },
      "outbox row names no registered intent; dead-lettering",
    );
    await deps.outbox.fail(row.id, false, 0);
    return;
  }
  try {
    const payload = def.payload.parse(JSON.parse(row.payload));
    await def.deliver(payload, {
      now: deps.clock.now(),
      tenantId: row.tenantId,
    });
    await deps.outbox.settle(row.id);
  } catch (error) {
    const classified = isDispatchError(error)
      ? error
      : toDispatchError(error, { message: "outbox intent delivery failed" });
    await deps.outbox.fail(
      row.id,
      classified.retryable,
      classified.retryAfterMs ?? DEFAULT_OUTBOX_RETRY_MS,
    );
  }
}

/**
 * Drains staged process-manager intents (ADR-108 §11). Delivery is classified
 * via `DispatchError`: a retryable failure schedules a backoff, anything else
 * dead-letters the row for an operator. No lease renewal — a worker killed
 * mid-delivery loses the lease and the row retries once it expires.
 */
export function createOutboxWorker(deps: {
  readonly outbox: Outbox;
  readonly registry: Pick<Registry, "all">;
  readonly clock: Clock;
  readonly metrics?: Metrics;
}): { start(): void; stop(): Promise<void> } {
  const logger = createLogger("langwatch:event-sourcing:outbox-worker");
  let running = false;
  let loopPromise: Promise<void> | null = null;

  async function runOnce(): Promise<"claimed" | "empty"> {
    const rows = await deps.outbox.claim(OUTBOX_CLAIM_LIMIT, OUTBOX_LEASE_MS);
    if (rows.length === 0) return "empty";
    for (const row of rows) await deliverOutboxRow(row, deps, logger);
    return "claimed";
  }

  async function loop(): Promise<void> {
    while (running) {
      const outcome = await runOnce();
      if (outcome === "empty") await sleep(POLL_INTERVAL_MS);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      loopPromise = loop();
    },
    async stop() {
      running = false;
      if (loopPromise !== null) await loopPromise;
      loopPromise = null;
    },
  };
}

const WAKE_POLL_INTERVAL_MS = 1_000;
const WAKE_BATCH_LIMIT = 50;

/** Collected per tick, not once: a pipeline registered after the poller started
 *  still gets its deadlines served. Only managers that declare `onWake` — a due
 *  row naming one that does not has nothing to run. */
function wakeableManagers(
  registry: Pick<Registry, "all">,
): Record<string, BuiltProcessManager> {
  const managers: Record<string, BuiltProcessManager> = {};
  for (const { pipeline } of registry.all()) {
    for (const [name, pm] of Object.entries(pipeline.processManagers)) {
      if (pm.onWake) managers[name] = pm;
    }
  }
  return managers;
}

/**
 * Wakes are polled from the store by deadline (ADR-108 §11) — no scheduler
 * beyond a fixed poll interval, since a wake's own deadline is the schedule.
 *
 * The read-evolve-write cycle itself is the process runtime's, never repeated
 * here (ADR-108 §11): a second copy of it drifted on the one decision that
 * matters most across a deploy — a row written before process managers carried
 * a version at all is resumable, not unresumable.
 */
export function createProcessWakePoller(deps: {
  readonly processStore: ProcessStore;
  readonly outbox: Outbox;
  readonly registry: Pick<Registry, "all">;
  readonly clock: Clock;
  readonly metrics?: Metrics;
}): { start(): void; stop(): Promise<void> } {
  const logger = createLogger("langwatch:event-sourcing:wake-poller");
  let running = false;
  let loopPromise: Promise<void> | null = null;
  const runtime = createProcessRuntime({
    processStore: deps.processStore,
    outbox: deps.outbox,
    clock: deps.clock,
    metrics: deps.metrics,
  });

  async function runOnce(): Promise<void> {
    try {
      await runtime.pollDue(wakeableManagers(deps.registry), {
        limit: WAKE_BATCH_LIMIT,
      });
    } catch (error) {
      // One undecodable instance must not stop the whole poll: the next tick
      // re-reads the same due set, so a genuinely wedged row is loud every
      // interval while every other deadline still fires.
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "wake poll failed; the next interval retries",
      );
    }
  }

  async function loop(): Promise<void> {
    while (running) {
      await runOnce();
      await sleep(WAKE_POLL_INTERVAL_MS);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      loopPromise = loop();
    },
    async stop() {
      running = false;
      if (loopPromise !== null) await loopPromise;
      loopPromise = null;
    },
  };
}
