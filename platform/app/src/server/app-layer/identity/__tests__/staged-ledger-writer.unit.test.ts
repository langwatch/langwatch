import { describe, expect, it, vi } from "vitest";
import { createTenantId } from "~/server/event-sourcing";
import type { Event } from "~/server/event-sourcing/domain/types";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import type {
  StateProjectionStore,
  StoredProjection,
} from "~/server/event-sourcing/projections/stateProjection.types";
import type { EventStore } from "~/server/event-sourcing/stores/eventStore.types";
import {
  type ReadYourWritesWait,
  StagedLedgerWriter,
  type StagedSender,
  type WaitedAppend,
} from "../staged-ledger-writer";

/**
 * The machinery the five identity ledger writers share, driven through a
 * ledger of its own so each leg can be asked about on its own.
 *
 * The five real writers are tested through their services; this covers what
 * they no longer each carry — the order of the legs, the read-your-writes
 * bound, and what a ledger that named no wait does instead.
 */

const AGGREGATE = "agg_1";
const TENANT = "tenant_1";
const T0 = 1_690_000_000_000;

interface TestState {
  marker: string;
}

interface TestCommand {
  type: "test.command";
  data: { note: string };
}

function testEvent({
  id,
  createdAt,
}: {
  id: string;
  createdAt: number;
}): Event {
  return {
    id,
    aggregateId: AGGREGATE,
    aggregateType: "test_aggregate",
    tenantId: createTenantId(TENANT),
    createdAt,
    occurredAt: createdAt,
    type: "test.integration.event",
    version: "2026-01-01",
    data: {},
  };
}

class InMemoryProjectionStore implements StateProjectionStore<TestState> {
  stored: StoredProjection<TestState> | null = null;
  loads = 0;
  unreadable: Error | null = null;

  async load(_key: string, _context: ProjectionStoreContext) {
    this.loads += 1;
    if (this.unreadable) throw this.unreadable;
    return this.stored;
  }

  async store(projection: StoredProjection<TestState>) {
    this.stored = projection;
  }

  /** What the queue's fold does when it drains the staged command. */
  advanceTo(event: Event) {
    this.stored = {
      state: { marker: event.id },
      cursor: { acceptedAt: event.createdAt, eventId: event.id },
      occurredAt: event.occurredAt,
      createdAt: T0,
      updatedAt: T0,
      version: "1",
    };
  }
}

/** A ledger that names all three legs and sequences them the way the real
 *  five do: append, stage, wait. */
class TestLedgerWriter extends StagedLedgerWriter<
  TestCommand,
  Event,
  TestState
> {
  readonly missingSenders: string[] = [];

  constructor(options: {
    stagedSender: (name: string) => Promise<StagedSender | null>;
    waitedAppend: WaitedAppend<Event> | null;
    readYourWrites: ReadYourWritesWait<TestState> | null;
  }) {
    super(options);
  }

  protected senderNameFor(command: TestCommand): string {
    return `send:${command.type}`;
  }

  protected onMissingSender({ senderName }: { senderName: string }): void {
    this.missingSenders.push(senderName);
  }

  async write({
    command,
    events,
  }: {
    command: TestCommand;
    events: Event[];
  }): Promise<void> {
    await this.append({ events, tenantId: TENANT });
    await this.stage({ command });
    await this.awaitConvergence({
      aggregateId: AGGREGATE,
      tenantId: TENANT,
      events,
    });
  }
}

const COMMAND: TestCommand = { type: "test.command", data: { note: "hello" } };

function harness(overrides?: {
  /** The queue never drains: the read-your-writes wait must expire. */
  foldNeverLands?: boolean;
  noSender?: boolean;
  stagingFails?: boolean;
  noAppend?: boolean;
  noWait?: boolean;
}) {
  const store = new InMemoryProjectionStore();
  const order: string[] = [];
  const staged: unknown[] = [];
  const timeouts: Array<{ aggregateId: string; eventCount: number }> = [];
  const unreadable: Array<{ aggregateId: string; error: unknown }> = [];
  const events = [
    testEvent({ id: "evt_1", createdAt: T0 }),
    testEvent({ id: "evt_2", createdAt: T0 + 1 }),
  ];

  const sender: StagedSender = {
    send: vi.fn(async (data: unknown) => {
      order.push("stage");
      if (overrides?.stagingFails) throw new Error("redis unavailable");
      staged.push(data);
      if (overrides?.foldNeverLands) return undefined;
      order.push("fold");
      store.advanceTo(events[events.length - 1]!);
      return undefined;
    }),
  };

  const storeEvents = vi.fn(async () => {
    order.push("append");
  });

  const ledger = new TestLedgerWriter({
    stagedSender: async () => (overrides?.noSender ? null : sender),
    waitedAppend: overrides?.noAppend
      ? null
      : {
          eventStore: async () =>
            ({ storeEvents }) as unknown as EventStore<Event>,
          aggregateType: "test_aggregate",
        },
    readYourWrites: overrides?.noWait
      ? null
      : {
          projectionStore: store,
          timeoutMs: 40,
          pollMs: 5,
          onTimeout: (args) => {
            timeouts.push(args);
          },
          onUnreadableProjection: (args) => {
            unreadable.push(args);
          },
        },
  });

  return { ledger, store, order, staged, timeouts, unreadable, events };
}

describe("the staged ledger writer", () => {
  describe("when a ledger names all three legs", () => {
    it("appends, then stages, then returns once the cursor reaches the last event", async () => {
      const { ledger, store, order, staged, events } = harness();

      await ledger.write({ command: COMMAND, events });

      expect(order).toEqual(["append", "stage", "fold"]);
      expect(staged).toEqual([{ note: "hello" }]);
      expect(store.stored?.cursor.eventId).toBe("evt_2");
      expect(store.loads).toBeGreaterThan(0);
    });

    it("counts a cursor that ties the last event's timestamp as converged", async () => {
      const { ledger, store, events } = harness({ foldNeverLands: true });
      const last = events[events.length - 1]!;
      store.advanceTo(last);

      await ledger.write({ command: COMMAND, events });

      // One load answered it: the cursor's event id is not behind the last
      // event's within the same millisecond.
      expect(store.loads).toBe(1);
    });
  });

  describe("when the fold does not land inside the convergence window", () => {
    it("gives the wait up at the bound, naming the aggregate and the events", async () => {
      const { ledger, order, timeouts, events } = harness({
        foldNeverLands: true,
      });

      const startedAt = Date.now();
      await ledger.write({ command: COMMAND, events });

      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(40);
      expect(timeouts).toEqual([{ aggregateId: AGGREGATE, eventCount: 2 }]);
      expect(order).toEqual(["append", "stage"]);
    });
  });

  describe("when the ledger names no read-your-writes wait", () => {
    it("returns after staging without reading the projection", async () => {
      const { ledger, store, order, timeouts, events } = harness({
        noWait: true,
        foldNeverLands: true,
      });

      await ledger.write({ command: COMMAND, events });

      expect(order).toEqual(["append", "stage"]);
      expect(store.loads).toBe(0);
      expect(timeouts).toEqual([]);
    });
  });

  describe("when the ledger names no append", () => {
    it("stages without resolving an event store", async () => {
      const { ledger, order, events } = harness({ noAppend: true });

      await ledger.write({ command: COMMAND, events });

      expect(order).toEqual(["stage", "fold"]);
    });
  });

  describe("when staging fails", () => {
    it("the failure reaches the caller, and nothing waits on a fold", async () => {
      const { ledger, store, order, events } = harness({ stagingFails: true });

      await expect(ledger.write({ command: COMMAND, events })).rejects.toThrow(
        "redis unavailable",
      );
      expect(order).toEqual(["append", "stage"]);
      expect(store.loads).toBe(0);
    });
  });

  describe("when the pipeline exposes no sender for the command", () => {
    it("hands the decision to the ledger rather than sending", async () => {
      const { ledger, staged, events } = harness({
        noSender: true,
        foldNeverLands: true,
      });

      await ledger.write({ command: COMMAND, events });

      expect(ledger.missingSenders).toEqual(["send:test.command"]);
      expect(staged).toEqual([]);
    });
  });

  describe("when the projection cannot be read", () => {
    it("stops waiting rather than failing the write", async () => {
      const { ledger, store, unreadable, timeouts, events } = harness({
        foldNeverLands: true,
      });
      store.unreadable = new Error("clickhouse unavailable");

      await ledger.write({ command: COMMAND, events });

      expect(unreadable).toHaveLength(1);
      expect(unreadable[0]?.aggregateId).toBe(AGGREGATE);
      expect(timeouts).toEqual([]);
    });
  });

  describe("when the ledger states no events", () => {
    it("skips the wait: there is no cursor to reach", async () => {
      const { ledger, store, timeouts } = harness({ foldNeverLands: true });

      await ledger.write({ command: COMMAND, events: [] });

      expect(store.loads).toBe(0);
      expect(timeouts).toEqual([]);
    });
  });
});
