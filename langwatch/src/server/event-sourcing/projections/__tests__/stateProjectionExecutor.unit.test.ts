import { describe, expect, it, vi } from "vitest";
import { createTenantId } from "../../domain/tenantId";
import type { Event } from "../../domain/types";
import {
  compareCursors,
  orderEvents,
  StateProjectionExecutor,
} from "../stateProjectionExecutor";
import type {
  StateProjectionDefinition,
  StateProjectionStore,
  StoredProjection,
} from "../stateProjection.types";

interface CounterState {
  count: number;
}

function event({
  id,
  acceptedAt,
  occurredAt,
  amount = 1,
}: {
  id: string;
  acceptedAt: number;
  occurredAt: number;
  amount?: number;
}): Event<{ amount: number }> {
  return {
    id,
    aggregateId: "conversation-1",
    aggregateType: "langy_conversation",
    tenantId: createTenantId("project-1"),
    createdAt: acceptedAt,
    occurredAt,
    type: "test.integration.event",
    version: "2026-07-15",
    data: { amount },
  };
}

function setup(initial: StoredProjection<CounterState> | null = null) {
  let stored = initial;
  const store: StateProjectionStore<CounterState> = {
    load: vi.fn(async () => stored),
    store: vi.fn(async (projection) => {
      stored = projection;
    }),
  };
  const apply = vi.fn(
    (state: CounterState, source: Event<{ amount: number }>) => ({
      count: state.count + source.data.amount,
    }),
  );
  const projection: StateProjectionDefinition<
    CounterState,
    Event<{ amount: number }>
  > = {
    name: "counter",
    version: "2026-07-15",
    eventTypes: ["test.integration.event"],
    init: () => ({ count: 0 }),
    apply,
    store,
  };
  const context = {
    aggregateId: "conversation-1",
    tenantId: createTenantId("project-1"),
  };
  return { apply, context, projection, store };
}

describe("StateProjectionExecutor", () => {
  describe("given an empty operational projection", () => {
    describe("when an event is applied", () => {
      it("stores deterministic entity timestamps and the canonical cursor", async () => {
        const { context, projection, store } = setup();

        await new StateProjectionExecutor().execute({
          projection,
          events: [event({ id: "event-a", acceptedAt: 200, occurredAt: 100 })],
          context,
        });

        expect(store.store).toHaveBeenCalledWith(
          {
            state: { count: 1 },
            cursor: { acceptedAt: 200, eventId: "event-a" },
            occurredAt: 100,
            createdAt: 100,
            updatedAt: 100,
            version: "2026-07-15",
          },
          context,
        );
      });
    });
  });

  describe("given an event cursor already stored", () => {
    describe("when the same or an older event is delivered", () => {
      it("does not apply or write it again", async () => {
        const initial: StoredProjection<CounterState> = {
          state: { count: 3 },
          cursor: { acceptedAt: 200, eventId: "event-b" },
          occurredAt: 150,
          createdAt: 50,
          updatedAt: 150,
          version: "2026-07-15",
        };
        const { apply, context, projection, store } = setup(initial);

        await new StateProjectionExecutor().execute({
          projection,
          events: [
            event({ id: "event-b", acceptedAt: 200, occurredAt: 150 }),
            event({ id: "event-a", acceptedAt: 200, occurredAt: 140 }),
          ],
          context,
        });

        expect(apply).not.toHaveBeenCalled();
        expect(store.store).not.toHaveBeenCalled();
      });
    });
  });

  describe("given same-instant events whose ids cross the base62 case boundary", () => {
    // KSUIDs encode the per-second sequence in ASCII base62 (0-9 < A-Z < a-z).
    // ICU collation ("Z".localeCompare("a") > 0) inverts that at the Z -> a
    // step, so cursor comparison must stay ordinal — it also has to agree
    // with ClickHouse, which orders String columns by bytes.
    const boundaryIds = [
      "event_0001aaaY",
      "event_0001aaaZ",
      "event_0001aaaa",
      "event_0001aaab",
    ];

    describe("when the batch is ordered", () => {
      it("keeps byte order across the boundary", () => {
        const shuffled = [
          boundaryIds[2]!,
          boundaryIds[0]!,
          boundaryIds[3]!,
          boundaryIds[1]!,
        ].map((id) => event({ id, acceptedAt: 200, occurredAt: 100 }));

        expect(orderEvents(shuffled).map((entry) => entry.id)).toEqual(
          boundaryIds,
        );
      });
    });

    describe("when cursors on either side of the boundary are compared", () => {
      it("ranks an uppercase-suffixed id before a lowercase-suffixed one", () => {
        expect(
          compareCursors(
            { acceptedAt: 200, eventId: boundaryIds[1]! },
            { acceptedAt: 200, eventId: boundaryIds[2]! },
          ),
        ).toBeLessThan(0);
      });
    });
  });

  describe("given a coalesced batch", () => {
    describe("when accepted timestamps tie", () => {
      it("folds by accepted time and event id and stores the final cursor", async () => {
        const { apply, context, projection, store } = setup();

        await new StateProjectionExecutor().execute({
          projection,
          events: [
            event({
              id: "event-b",
              acceptedAt: 200,
              occurredAt: 90,
              amount: 2,
            }),
            event({
              id: "event-a",
              acceptedAt: 200,
              occurredAt: 100,
              amount: 1,
            }),
          ],
          context,
        });

        expect(apply.mock.calls.map((call) => call[1].id)).toEqual([
          "event-a",
          "event-b",
        ]);
        expect(store.store).toHaveBeenCalledWith(
          expect.objectContaining({
            state: { count: 3 },
            cursor: { acceptedAt: 200, eventId: "event-b" },
            createdAt: 100,
            updatedAt: 100,
            occurredAt: 90,
          }),
          context,
        );
      });
    });
  });
});
