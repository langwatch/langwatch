import { describe, it, expect, vi } from "vitest";

import { StateAccumulator } from "../replayExecutor";
import { StateProjectionExecutor } from "../../projections/stateProjectionExecutor";
import type {
  StateProjectionDefinition,
  StateProjectionStore,
  StoredProjection,
} from "../../projections/stateProjection.types";
import type { ProjectionStoreContext } from "../../projections/projectionStoreContext";
import { createTenantId } from "../../domain/tenantId";
import type { Event } from "../../domain/types";
import type { RetentionPolicyResolver } from "../../../data-retention/retentionPolicyResolver";
import type { ResolvedRetention } from "../../../data-retention/retentionPolicy.schema";

interface CounterState {
  count: number;
  amounts: number[];
}

type CounterEvent = Event<{ amount?: number; group?: string }> & {
  timestamp: number;
  idempotencyKey: string;
};

type CounterEventOverrides = Omit<Partial<CounterEvent>, "tenantId"> & {
  tenantId?: string;
};

const MATCHING_EVENT_TYPE = "test.integration.event" as const;
const OTHER_EVENT_TYPE = "lw.obs.trace.span_received" as const;

/**
 * A spy StateProjectionStore. `load` MUST never be called by a rebuild — the
 * accumulator starts from `init()`, so a load call is a bug (would mean it is
 * merging with an existing row instead of rebuilding).
 */
function spyStore(seed?: StoredProjection<CounterState>) {
  const writes: Array<{
    projection: StoredProjection<CounterState>;
    context: ProjectionStoreContext;
  }> = [];
  const store: StateProjectionStore<CounterState> = {
    load: vi.fn(async () => seed ?? null),
    store: vi.fn(async (projection, context) => {
      writes.push({ projection, context });
    }),
  };
  return { store, writes };
}

function projection(
  store: StateProjectionStore<CounterState>,
  overrides?: Partial<
    Pick<
      StateProjectionDefinition<CounterState, CounterEvent>,
      "eventTypes" | "key" | "version"
    >
  >,
): StateProjectionDefinition<CounterState, CounterEvent> {
  return {
    name: "counter",
    version: overrides?.version ?? "2026-07-16",
    eventTypes: overrides?.eventTypes ?? [MATCHING_EVENT_TYPE],
    init: () => ({ count: 0, amounts: [] }),
    apply: (state, event) => {
      const amount = (event.data as { amount?: number })?.amount ?? 0;
      return {
        count: state.count + amount,
        amounts: [...state.amounts, amount],
      };
    },
    store,
    ...(overrides?.key ? { key: overrides.key } : {}),
  };
}

let seq = 0;
function makeEvent(overrides: CounterEventOverrides = {}): CounterEvent {
  seq += 1;
  const createdAt = overrides.createdAt ?? 1_700_000_000_000 + seq;
  return {
    id: overrides.id ?? `ksuid-${String(seq).padStart(4, "0")}`,
    aggregateId: overrides.aggregateId ?? "conv-1",
    aggregateType: overrides.aggregateType ?? "langy_conversation",
    tenantId: createTenantId(overrides.tenantId ?? "project-1"),
    createdAt,
    timestamp: overrides.timestamp ?? createdAt,
    occurredAt: overrides.occurredAt ?? createdAt,
    type: overrides.type ?? MATCHING_EVENT_TYPE,
    version: overrides.version ?? "2026-07-16",
    idempotencyKey: overrides.idempotencyKey ?? overrides.id ?? `idem-${seq}`,
    data: overrides.data ?? { amount: 1 },
  };
}

describe("StateAccumulator", () => {
  describe("given a rebuild from the canonical log", () => {
    it("never calls store.load — it rebuilds from init(), it does not merge", async () => {
      const { store, writes } = spyStore({
        // A pre-existing row that MUST be ignored by a rebuild.
        state: { count: 999, amounts: [999] },
        cursor: { acceptedAt: 1, eventId: "old" },
        occurredAt: 1,
        createdAt: 1,
        updatedAt: 1,
        version: "old",
      });
      const acc = new StateAccumulator(projection(store));

      acc.apply(makeEvent({ data: { amount: 2 } }));
      acc.apply(makeEvent({ data: { amount: 3 } }));
      await acc.flush();

      expect(store.load).not.toHaveBeenCalled();
      expect(writes).toHaveLength(1);
      // From init(), not merged onto the seed's 999.
      expect(writes[0]!.projection.state).toEqual({
        count: 5,
        amounts: [2, 3],
      });
    });

    it("writes deterministic occurredAt/createdAt/updatedAt/version and an (acceptedAt,eventId) cursor", async () => {
      const { store, writes } = spyStore();
      const acc = new StateAccumulator(projection(store, { version: "v-42" }));

      // createdAt (accepted) ascending; occurredAt deliberately NOT monotone.
      acc.apply(
        makeEvent({
          id: "e1",
          createdAt: 100,
          occurredAt: 5_000,
          data: { amount: 1 },
        }),
      );
      acc.apply(
        makeEvent({
          id: "e2",
          createdAt: 200,
          occurredAt: 1_000,
          data: { amount: 1 },
        }),
      );
      acc.apply(
        makeEvent({
          id: "e3",
          createdAt: 300,
          occurredAt: 9_000,
          data: { amount: 1 },
        }),
      );
      await acc.flush();

      const row = writes[0]!.projection;
      expect(row.version).toBe("v-42");
      // cursor = last applied event's (createdAt, id)
      expect(row.cursor).toEqual({ acceptedAt: 300, eventId: "e3" });
      // occurredAt = last applied event's occurredAt
      expect(row.occurredAt).toBe(9_000);
      // createdAt = first applied event's occurredAt
      expect(row.createdAt).toBe(5_000);
      // updatedAt = max occurredAt across applied events
      expect(row.updatedAt).toBe(9_000);
    });

    it("produces the SAME row the live StateProjectionExecutor would (parity)", async () => {
      const events = [
        makeEvent({
          id: "a",
          createdAt: 10,
          occurredAt: 700,
          data: { amount: 2 },
        }),
        makeEvent({
          id: "b",
          createdAt: 20,
          occurredAt: 300,
          data: { amount: 5 },
        }),
        makeEvent({
          id: "c",
          createdAt: 30,
          occurredAt: 900,
          data: { amount: 1 },
        }),
      ];

      const { store: accStore, writes } = spyStore();
      const acc = new StateAccumulator(projection(accStore));
      for (const e of events) acc.apply(e);
      await acc.flush();

      // Live executor over the same events, loading nothing (fresh key).
      const { store: liveStore } = spyStore();
      const executor = new StateProjectionExecutor();
      const live = await executor.execute({
        projection: projection(liveStore),
        events,
        context: {
          aggregateId: "conv-1",
          tenantId: "project-1" as never,
        },
      });

      expect(writes[0]!.projection).toEqual(live);
    });
  });

  describe("given events across tenants and keys", () => {
    it("isolates state by tenant even for an identical projection key", async () => {
      const { store, writes } = spyStore();
      const acc = new StateAccumulator(projection(store));

      acc.apply(
        makeEvent({
          tenantId: "t-a",
          aggregateId: "conv-1",
          data: { amount: 1 },
        }),
      );
      acc.apply(
        makeEvent({
          tenantId: "t-b",
          aggregateId: "conv-1",
          data: { amount: 10 },
        }),
      );
      await acc.flush();

      expect(writes).toHaveLength(2);
      const byTenant = new Map(
        writes.map((w) => [w.context.tenantId as string, w]),
      );
      expect(byTenant.get("t-a")!.projection.state.count).toBe(1);
      expect(byTenant.get("t-a")!.context.key).toBe("conv-1");
      expect(byTenant.get("t-b")!.projection.state.count).toBe(10);
    });

    it("groups by projection.key, folding several aggregates into one row", async () => {
      const { store, writes } = spyStore();
      const acc = new StateAccumulator(
        projection(store, {
          // Group by a field in the event payload, spanning aggregates.
          key: (event) => (event.data as { group: string }).group,
        }),
      );

      acc.apply(
        makeEvent({ aggregateId: "conv-1", data: { amount: 1, group: "g1" } }),
      );
      acc.apply(
        makeEvent({ aggregateId: "conv-2", data: { amount: 2, group: "g1" } }),
      );
      acc.apply(
        makeEvent({ aggregateId: "conv-3", data: { amount: 4, group: "g2" } }),
      );
      await acc.flush();

      const byKey = new Map(writes.map((w) => [w.context.key, w]));
      expect(byKey.size).toBe(2);
      expect(byKey.get("g1")!.projection.state.count).toBe(3);
      expect(byKey.get("g2")!.projection.state.count).toBe(4);
    });
  });

  describe("given events the projection does not declare or has already seen", () => {
    it("skips non-matching event types without folding them", async () => {
      const { store, writes } = spyStore();
      const acc = new StateAccumulator(
        projection(store, { eventTypes: [MATCHING_EVENT_TYPE] }),
      );

      acc.apply(makeEvent({ type: MATCHING_EVENT_TYPE, data: { amount: 1 } }));
      acc.apply(makeEvent({ type: OTHER_EVENT_TYPE, data: { amount: 100 } }));
      acc.apply(makeEvent({ type: MATCHING_EVENT_TYPE, data: { amount: 1 } }));
      await acc.flush();

      expect(acc.processed).toBe(2);
      expect(writes[0]!.projection.state.count).toBe(2);
    });

    it("folds a duplicate or stale-cursor redelivery at most once", async () => {
      const { store, writes } = spyStore();
      const acc = new StateAccumulator(projection(store));

      const e1 = makeEvent({
        id: "dup",
        createdAt: 100,
        occurredAt: 100,
        data: { amount: 7 },
      });
      acc.apply(e1);
      acc.apply(e1); // exact duplicate
      // A strictly-earlier cursor than the latest — a stale redelivery.
      acc.apply(
        makeEvent({
          id: "aaa",
          createdAt: 50,
          occurredAt: 50,
          data: { amount: 100 },
        }),
      );
      await acc.flush();

      expect(writes).toHaveLength(1);
      expect(writes[0]!.projection.state).toEqual({ count: 7, amounts: [7] });
      expect(writes[0]!.projection.cursor).toEqual({
        acceptedAt: 100,
        eventId: "dup",
      });
    });
  });

  describe("given a retention resolver is wired", () => {
    it("stamps the tenant's resolved retention on the write context", async () => {
      const resolved = { retentionDays: 90 } as unknown as ResolvedRetention;
      const resolver: RetentionPolicyResolver = {
        resolve: vi.fn(async () => resolved),
      } as unknown as RetentionPolicyResolver;

      const { store, writes } = spyStore();
      const acc = new StateAccumulator(projection(store), {
        retentionResolver: resolver,
      });

      acc.apply(makeEvent({ tenantId: "t-a" }));
      acc.apply(makeEvent({ tenantId: "t-a" }));
      await acc.flush();

      expect(writes[0]!.context.retentionPolicy).toBe(resolved);
      // Resolved once per tenant, not once per event.
      expect(
        resolver.resolve as ReturnType<typeof vi.fn>,
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe("given no matching events", () => {
    it("writes nothing", async () => {
      const { store, writes } = spyStore();
      const acc = new StateAccumulator(
        projection(store, { eventTypes: [MATCHING_EVENT_TYPE] }),
      );
      acc.apply(makeEvent({ type: OTHER_EVENT_TYPE }));
      await acc.flush();

      expect(store.store).not.toHaveBeenCalled();
      expect(writes).toHaveLength(0);
    });
  });
});
