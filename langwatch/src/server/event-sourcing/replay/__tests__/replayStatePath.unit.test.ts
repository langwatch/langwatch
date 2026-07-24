import { describe, it, expect, vi } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";

import { replayStateProjection } from "../replayStatePath";
import { replayOptimized } from "../replayOptimizedPath";
import type { RegisteredStateProjection, ReplayContext } from "../types";
import type {
  StateProjectionDefinition,
  StateProjectionStore,
  StoredProjection,
} from "../../projections/stateProjection.types";
import type { ProjectionStoreContext } from "../../projections/projectionStoreContext";
import { nullLog } from "../replayLog";

interface CounterState {
  count: number;
}

interface Row {
  TenantId: string;
  AggregateType: string;
  AggregateId: string;
  EventId: string;
  EventType: string;
  EventTimestamp: number;
  EventOccurredAt: number;
  EventVersion: string;
  EventPayload: string;
}

/**
 * A faithful in-memory `event_log` that answers the four query shapes the
 * state replay path issues (discover, count, occurred-at bounds, cutoff,
 * load), computed from `rows` + query_params — no ClickHouse container.
 */
function makeFakeClickHouse(rows: Row[]) {
  const queries: string[] = [];
  const client = {
    query: async ({
      query,
      query_params,
    }: {
      query: string;
      query_params?: Record<string, any>;
      format?: string;
    }) => {
      queries.push(query);
      const p = query_params ?? {};

      if (query.includes("groupUniqArray(EventType)")) {
        const et: string[] = p.eventTypes ?? [];
        const since: number = p.sinceMs ?? 0;
        const tenant: string | undefined = p.tenantId;
        const matched = rows.filter(
          (r) =>
            et.includes(r.EventType) &&
            r.EventTimestamp >= since &&
            (!tenant || r.TenantId === tenant),
        );
        const groups = new Map<
          string,
          {
            tenantId: string;
            aggregateType: string;
            aggregateId: string;
            eventTypes: Set<string>;
          }
        >();
        for (const r of matched) {
          const k = `${r.TenantId}|${r.AggregateType}|${r.AggregateId}`;
          let g = groups.get(k);
          if (!g) {
            g = {
              tenantId: r.TenantId,
              aggregateType: r.AggregateType,
              aggregateId: r.AggregateId,
              eventTypes: new Set(),
            };
            groups.set(k, g);
          }
          g.eventTypes.add(r.EventType);
        }
        const out = [...groups.values()].map((g) => ({
          tenantId: g.tenantId,
          aggregateType: g.aggregateType,
          aggregateId: g.aggregateId,
          eventTypes: [...g.eventTypes],
        }));
        return { json: async () => out };
      }

      if (query.includes("as totalEvents")) {
        return { json: async () => [{ totalEvents: String(rows.length) }] };
      }

      if (query.includes("AS minOccurredAt")) {
        const aggTypes: string[] = p.aggregateTypes ?? [];
        const aggIds: string[] = p.aggregateIds ?? [];
        const matched = rows.filter(
          (r) =>
            r.TenantId === p.tenantId &&
            aggTypes.includes(r.AggregateType) &&
            aggIds.includes(r.AggregateId),
        );
        if (matched.length === 0) {
          return {
            json: async () => [
              { cnt: "0", minOccurredAt: "0", maxOccurredAt: "0" },
            ],
          };
        }
        return {
          json: async () => [
            {
              cnt: String(matched.length),
              minOccurredAt: String(
                Math.min(...matched.map((r) => r.EventOccurredAt)),
              ),
              maxOccurredAt: String(
                Math.max(...matched.map((r) => r.EventOccurredAt)),
              ),
            },
          ],
        };
      }

      if (query.includes("cutoffEventId")) {
        const et: string[] = p.eventTypes ?? [];
        const aggIds: string[] = p.aggregateIds ?? [];
        const matched = rows.filter(
          (r) =>
            r.TenantId === p.tenantId &&
            et.includes(r.EventType) &&
            aggIds.includes(r.AggregateId),
        );
        const byAgg = new Map<string, Row>();
        for (const r of matched) {
          const k = `${r.AggregateType}|${r.AggregateId}`;
          const cur = byAgg.get(k);
          if (
            !cur ||
            r.EventTimestamp > cur.EventTimestamp ||
            (r.EventTimestamp === cur.EventTimestamp && r.EventId > cur.EventId)
          ) {
            byAgg.set(k, r);
          }
        }
        return {
          json: async () =>
            [...byAgg.values()].map((r) => ({
              aggregateType: r.AggregateType,
              aggregateId: r.AggregateId,
              cutoffEventId: r.EventId,
              cutoffTimestamp: String(r.EventTimestamp),
            })),
        };
      }

      if (query.includes("ORDER BY EventTimestamp ASC, EventId ASC")) {
        const et: string[] = p.eventTypes ?? [];
        const aggIds: string[] = p.aggregateIds ?? [];
        let matched = rows.filter(
          (r) =>
            r.TenantId === p.tenantId &&
            et.includes(r.EventType) &&
            aggIds.includes(r.AggregateId) &&
            (r.EventTimestamp < p.maxCutoffTimestamp ||
              (r.EventTimestamp === p.maxCutoffTimestamp &&
                r.EventId <= p.maxCutoffEventId)),
        );
        if (p.cursorEventId) {
          matched = matched.filter(
            (r) =>
              r.EventTimestamp > p.cursorTimestamp ||
              (r.EventTimestamp === p.cursorTimestamp &&
                r.EventId > p.cursorEventId),
          );
        }
        matched.sort(
          (a, b) =>
            a.EventTimestamp - b.EventTimestamp ||
            a.EventId.localeCompare(b.EventId),
        );
        matched = matched.slice(0, p.batchSize ?? 5000);
        return {
          json: async () =>
            matched.map((r) => ({
              EventId: r.EventId,
              EventTimestamp: r.EventTimestamp,
              EventOccurredAt: r.EventOccurredAt,
              EventType: r.EventType,
              EventPayload: r.EventPayload,
              EventVersion: r.EventVersion,
              TenantId: r.TenantId,
              AggregateType: r.AggregateType,
              AggregateId: r.AggregateId,
              IdempotencyKey: r.EventId,
            })),
        };
      }

      throw new Error(`unexpected query: ${query.slice(0, 80)}`);
    },
  };
  return { client: client as unknown as ClickHouseClient, queries };
}

function counterEvent(o: {
  tenant: string;
  agg: string;
  id: string;
  ts: number;
  occurredAt: number;
  amount: number;
  type?: string;
}): Row {
  return {
    TenantId: o.tenant,
    AggregateType: "langy_conversation",
    AggregateId: o.agg,
    EventId: o.id,
    EventType: o.type ?? "counter.incremented",
    EventTimestamp: o.ts,
    EventOccurredAt: o.occurredAt,
    EventVersion: "2026-07-16",
    EventPayload: JSON.stringify({ amount: o.amount }),
  };
}

function spyStore() {
  const writes: Array<{
    projection: StoredProjection<CounterState>;
    context: ProjectionStoreContext;
  }> = [];
  const store: StateProjectionStore<CounterState> = {
    load: vi.fn(async () => null),
    store: vi.fn(async (projection, context) => {
      writes.push({ projection, context });
    }),
  };
  return { store, writes };
}

function registered(
  store: StateProjectionStore<CounterState>,
): RegisteredStateProjection {
  const definition: StateProjectionDefinition<CounterState, any> = {
    name: "counter",
    version: "2026-07-16",
    eventTypes: ["counter.incremented"],
    init: () => ({ count: 0 }),
    apply: (state, event) => ({
      count: state.count + ((event.data as { amount?: number })?.amount ?? 0),
    }),
    store,
  };
  return {
    projectionName: "counter",
    pipelineName: "langy_conversation_processing",
    aggregateType: "langy_conversation",
    source: "pipeline",
    definition,
    pauseKey: "langy_conversation_processing/stateProjection/counter",
    kind: "state",
  };
}

function replayRedis() {
  const calls: string[] = [];
  const redis = {
    sadd: vi.fn(async (_key: string, pauseKey: string) => {
      calls.push(`pause:${pauseKey}`);
      return 1;
    }),
    scan: vi.fn(async () => ["0", []] as [string, string[]]),
    srem: vi.fn(async (_key: string, pauseKey: string) => {
      calls.push(`unpause:${pauseKey}`);
      return 1;
    }),
    lpush: vi.fn(async () => 1),
  } as unknown as ReplayContext["redis"];
  return { redis, calls };
}

/** Dry-run/guard sentinel: those paths must not touch the pause seam. */
const forbiddenRedis = new Proxy(
  {},
  {
    get() {
      throw new Error("this replay path must not touch redis");
    },
  },
) as unknown as ReplayContext["redis"];

describe("replayStateProjection", () => {
  it("reads canonical events, groups by tenant + key, and rebuilds each store row from init", async () => {
    const rows = [
      // tenant t-a, conv-1: two counter events + one non-declared type
      counterEvent({
        tenant: "t-a",
        agg: "conv-1",
        id: "a-001",
        ts: 100,
        occurredAt: 5_000,
        amount: 2,
      }),
      counterEvent({
        tenant: "t-a",
        agg: "conv-1",
        id: "a-002",
        ts: 200,
        occurredAt: 1_000,
        amount: 3,
      }),
      counterEvent({
        tenant: "t-a",
        agg: "conv-1",
        id: "a-003",
        ts: 300,
        occurredAt: 9_000,
        amount: 99,
        type: "counter.ignored",
      }),
      // tenant t-b, conv-9: one counter event
      counterEvent({
        tenant: "t-b",
        agg: "conv-9",
        id: "b-001",
        ts: 150,
        occurredAt: 4_000,
        amount: 10,
      }),
    ];
    const { client, queries } = makeFakeClickHouse(rows);
    const { store, writes } = spyStore();
    const resolvedTenants: string[] = [];
    const { redis, calls: redisCalls } = replayRedis();

    const ctx: ReplayContext = {
      redis,
      resolveClient: async (tenantId?: string) => {
        if (tenantId) resolvedTenants.push(tenantId);
        return client;
      },
      accumulatorOpts: {},
    };

    const result = await replayStateProjection({
      ctx,
      projection: registered(store),
      projectionIndex: 0,
      totalProjections: 1,
      tenantIds: ["t-a", "t-b"],
      since: "1970-01-01T00:00:00.000Z",
      batchSize: 100,
      aggregateBatchSize: 100,
      dryRun: false,
      log: nullLog,
    });

    // Never merged with an existing row.
    expect(store.load).not.toHaveBeenCalled();
    // Only SELECTs — the state path reads CH, never writes it.
    expect(
      queries.every((q) => q.trim().toUpperCase().startsWith("SELECT")),
    ).toBe(true);

    // One row per (tenant, key).
    expect(writes).toHaveLength(2);
    const byKey = new Map(
      writes.map((w) => [`${w.context.tenantId}/${w.context.key}`, w]),
    );

    const a = byKey.get("t-a/conv-1")!;
    // The non-declared event type was filtered out (only 2 + 3 folded).
    expect(a.projection.state).toEqual({ count: 5 });
    // Deterministic cursor + timestamps.
    expect(a.projection.cursor).toEqual({ acceptedAt: 200, eventId: "a-002" });
    expect(a.projection.createdAt).toBe(5_000); // first applied event's occurredAt
    expect(a.projection.occurredAt).toBe(1_000); // last applied event's occurredAt
    expect(a.projection.updatedAt).toBe(5_000); // max occurredAt
    expect(a.projection.version).toBe("2026-07-16");

    const b = byKey.get("t-b/conv-9")!;
    expect(b.projection.state).toEqual({ count: 10 });

    expect(result.aggregatesReplayed).toBe(2);
    expect(result.totalEvents).toBe(3); // 2 (conv-1) + 1 (conv-9); ignored not loaded
    expect(result.batchErrors).toBe(0);
    expect(result.touchedTenants.sort()).toEqual(["t-a", "t-b"]);
    expect(redisCalls).toEqual([
      "pause:langy_conversation_processing/stateProjection/counter",
      "unpause:langy_conversation_processing/stateProjection/counter",
    ]);
    // Both tenants' clients were resolved for the batch read lane.
    expect(new Set(resolvedTenants)).toEqual(new Set(["t-a", "t-b"]));
  });

  it("pages in accepted order when event IDs sort in the opposite order", async () => {
    const rows = [
      counterEvent({
        tenant: "t-a",
        agg: "evaluation-random-id",
        id: "z-accepted-first",
        ts: 100,
        occurredAt: 100,
        amount: 2,
      }),
      counterEvent({
        tenant: "t-a",
        agg: "evaluation-random-id",
        id: "a-accepted-second",
        ts: 200,
        occurredAt: 200,
        amount: 3,
      }),
    ];
    const { client } = makeFakeClickHouse(rows);
    const { store, writes } = spyStore();
    const { redis } = replayRedis();

    const result = await replayStateProjection({
      ctx: {
        redis,
        resolveClient: async () => client,
        accumulatorOpts: {},
      },
      projection: registered(store),
      projectionIndex: 0,
      totalProjections: 1,
      tenantIds: ["t-a"],
      since: "1970-01-01T00:00:00.000Z",
      // Force the cursor to cross the reverse-sorted IDs between pages.
      batchSize: 1,
      aggregateBatchSize: 100,
      dryRun: false,
      log: nullLog,
    });

    expect(result.totalEvents).toBe(2);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.projection.state).toEqual({ count: 5 });
    expect(writes[0]!.projection.cursor).toEqual({
      acceptedAt: 200,
      eventId: "a-accepted-second",
    });
  });

  it("writes nothing and touches no store on a dry run", async () => {
    const rows = [
      counterEvent({
        tenant: "t-a",
        agg: "conv-1",
        id: "a-001",
        ts: 100,
        occurredAt: 100,
        amount: 2,
      }),
    ];
    const { client } = makeFakeClickHouse(rows);
    const { store } = spyStore();
    const ctx: ReplayContext = {
      redis: forbiddenRedis,
      resolveClient: async () => client,
      accumulatorOpts: {},
    };

    const result = await replayStateProjection({
      ctx,
      projection: registered(store),
      projectionIndex: 0,
      totalProjections: 1,
      tenantIds: ["t-a"],
      since: "1970-01-01T00:00:00.000Z",
      batchSize: 100,
      aggregateBatchSize: 100,
      dryRun: true,
      log: nullLog,
    });

    expect(store.store).not.toHaveBeenCalled();
    expect(store.load).not.toHaveBeenCalled();
    expect(result.totalEvents).toBe(0);
  });
});

describe("replayOptimized with state projections", () => {
  it("rejects a config carrying state projections rather than silently skipping them", async () => {
    const { store } = spyStore();
    const ctx = {
      redis: forbiddenRedis,
      resolveClient: async () => {
        throw new Error("should not resolve — guard must fire first");
      },
      accumulatorOpts: {},
    } as unknown as ReplayContext;

    await expect(
      replayOptimized({
        ctx,
        config: {
          projections: [],
          stateProjections: [registered(store)],
          tenantIds: ["t-a"],
          since: "1970-01-01T00:00:00.000Z",
        },
      }),
    ).rejects.toThrow(/does not support state projections/);

    // The guard fired before any store or CH work.
    expect(store.store).not.toHaveBeenCalled();
    expect(store.load).not.toHaveBeenCalled();
  });
});
