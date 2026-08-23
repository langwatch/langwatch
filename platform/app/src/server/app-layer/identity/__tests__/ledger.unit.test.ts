import { emptyIdentityHeads } from "@langwatch/identity";
import {
  IdentityGuards,
  type IdentityHeadsRepository,
  IdentityService,
} from "@langwatch/identity-server";
import { describe, expect, it, vi } from "vitest";
import type { IdentityFoldState } from "~/server/event-sourcing/pipelines/identity/projections/identityState.foldProjection";
import type { IdentityEvent } from "~/server/event-sourcing/pipelines/identity/schemas/events";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import type {
  StateProjectionStore,
  StoredProjection,
} from "~/server/event-sourcing/projections/stateProjection.types";
import type { EventStore } from "~/server/event-sourcing/stores/eventStore.types";
import { IdentityLedgerWriter } from "../ledger";
import { identityStagingDroppedTotal } from "../metrics";

const USER = "user_sam";
const ACTOR = { type: "user" as const, id: USER };
const T0 = 1_690_000_000_000;

class InMemoryStateStore implements StateProjectionStore<IdentityFoldState> {
  readonly stored = new Map<string, StoredProjection<IdentityFoldState>>();
  readonly storeContexts: ProjectionStoreContext[] = [];
  shouldFailNextStore = false;

  async load(key: string, _context: ProjectionStoreContext) {
    return this.stored.get(key) ?? null;
  }

  async store(
    projection: StoredProjection<IdentityFoldState>,
    context: ProjectionStoreContext,
  ) {
    if (this.shouldFailNextStore) {
      this.shouldFailNextStore = false;
      throw new Error("postgres unavailable");
    }
    this.storeContexts.push(context);
    this.stored.set(context.aggregateId, projection);
  }
}

/** The heads as the Prisma repository would read them: off the projection
 *  the calling path just wrote — read-your-writes, which is the point. */
class ProjectionHeads implements IdentityHeadsRepository {
  constructor(private readonly store: InMemoryStateStore) {}

  async findUserHashKey() {
    return "key_material";
  }

  async findActiveIdentifierByValue() {
    return null;
  }

  async findHeads({ userId }: { userId: string }) {
    const stored = this.store.stored.get(userId);
    return stored
      ? { userId, identifiers: stored.state.identifiers }
      : emptyIdentityHeads({ userId });
  }

  async findIdentifier({
    userId,
    identifierId,
  }: {
    userId: string;
    identifierId: string;
  }) {
    return (
      this.store.stored.get(userId)?.state.identifiers[identifierId] ?? null
    );
  }

  async findIdentifierIdForAccount() {
    return null;
  }
}

function harness(overrides?: {
  shouldAppendFail?: boolean;
  shouldStagingFail?: boolean;
  shouldStagingHang?: boolean;
  stagingTimeoutMs?: number;
}) {
  const store = new InMemoryStateStore();
  const appended: IdentityEvent[][] = [];
  const staged: unknown[] = [];
  const order: string[] = [];

  const eventStore = {
    storeEvents: vi.fn(async (events: readonly IdentityEvent[]) => {
      order.push("append");
      if (overrides?.shouldAppendFail)
        throw new Error("clickhouse unavailable");
      appended.push([...events]);
    }),
  } as unknown as EventStore<IdentityEvent>;

  const sender = {
    send: vi.fn((data: unknown) => {
      order.push("stage");
      if (overrides?.shouldStagingHang) return new Promise<unknown>(() => {});
      if (overrides?.shouldStagingFail) {
        return Promise.reject(new Error("redis unavailable"));
      }
      staged.push(data);
      return Promise.resolve(undefined as unknown);
    }),
  };

  const trackedStore: StateProjectionStore<IdentityFoldState> = {
    load: (key, context) => store.load(key, context),
    store: async (projection, context) => {
      order.push("apply");
      return store.store(projection, context);
    },
  };

  const ledger = new IdentityLedgerWriter({
    projectionStore: trackedStore,
    eventStore: async () => eventStore,
    stagedSender: () => sender,
    ...(overrides?.stagingTimeoutMs !== undefined
      ? { stagingTimeoutMs: overrides.stagingTimeoutMs }
      : {}),
  });
  const identity = new IdentityService(
    new IdentityGuards(new ProjectionHeads(store)),
    ledger,
  );

  return { identity, store, appended, staged, order, sender };
}

function attachData(overrides?: Record<string, unknown>) {
  return {
    tenantId: USER,
    userId: USER,
    commandId: "idcmd_1",
    accountId: null,
    provider: "google" as const,
    providerAccountId: "gid_1",
    value: "Sam.J@Acme.com",
    occurredAtMs: T0,
    ceremony: { flow: "better-auth" },
    actor: ACTOR,
    ...overrides,
  };
}

async function counterValue(counter: {
  get: () => Promise<{ values: Array<{ value: number }> }>;
}): Promise<number> {
  const metric = await counter.get();
  return metric.values.reduce((sum, sample) => sum + sample.value, 0);
}

describe("the identity ledger writer", () => {
  describe("when a ceremony commits facts", () => {
    it("appends durably, applies on the calling path, and stages last", async () => {
      const { identity, store, appended, staged, order } = harness();

      const events = await identity.attachIdentifier(attachData());

      expect(events).toHaveLength(1);
      expect(order).toEqual(["append", "apply", "stage"]);
      expect(appended[0]).toHaveLength(1);
      expect(staged).toHaveLength(1);

      // Read-your-writes: the projection holds the row before commit returns.
      const projection = store.stored.get(USER)!;
      const facts = Object.values(projection.state.identifiers);
      expect(facts[0]!.value).toBe("sam.j@acme.com");
      expect(projection.cursor.eventId).toBe((events[0] as IdentityEvent).id);
    });

    it("stages the COMMAND, not the facts: the queue re-runs the guard", async () => {
      const { identity, staged } = harness();
      await identity.attachIdentifier(attachData());
      expect(staged[0]).toMatchObject({
        commandId: "idcmd_1",
        value: "Sam.J@Acme.com",
      });
    });
  });

  describe("when the calling-path fold builds its projection context", () => {
    it("reads the command's tenantId — the same field the append leg keys on", async () => {
      const { identity, store } = harness();

      await identity.attachIdentifier(attachData());

      expect(store.storeContexts).toHaveLength(1);
      expect(store.storeContexts[0]?.tenantId).toBe(USER);
    });
  });

  describe("when GroupQueue staging fails after the durable append", () => {
    it("the ceremony still succeeds; the drop is absorbed", async () => {
      const { identity, store, appended, order } = harness({
        shouldStagingFail: true,
      });

      const events = await identity.attachIdentifier(attachData());

      expect(events).toHaveLength(1);
      expect(appended).toHaveLength(1);
      expect(order).toEqual(["append", "apply", "stage"]);
      expect(store.stored.get(USER)).toBeDefined();
    });
  });

  describe("when GroupQueue staging hangs instead of failing fast", () => {
    /** @scenario "A hanging Redis cannot fail or stall an identity ceremony" */
    it("the staging budget drops it, counted; append and apply landed and the ceremony succeeds", async () => {
      const { identity, appended, store, sender } = harness({
        shouldStagingHang: true,
        stagingTimeoutMs: 20,
      });
      const droppedBefore = await counterValue(identityStagingDroppedTotal);

      const events = await identity.attachIdentifier(attachData());

      expect(events).toHaveLength(1);
      expect(appended).toHaveLength(1);
      expect(store.stored.size).toBe(1);
      expect(sender.send).toHaveBeenCalledTimes(1);
      expect(await counterValue(identityStagingDroppedTotal)).toBe(
        droppedBefore + 1,
      );
    });
  });

  describe("when the calling-path apply fails after the durable append", () => {
    it("the ceremony still succeeds and staging still runs", async () => {
      const { identity, store, appended, order } = harness();
      store.shouldFailNextStore = true;

      const events = await identity.attachIdentifier(attachData());

      expect(events).toHaveLength(1);
      expect(appended).toHaveLength(1);
      expect(order).toEqual(["append", "apply", "stage"]);
      expect(store.stored.get(USER)).toBeUndefined();
    });
  });

  describe("when the durable append itself fails", () => {
    it("the ceremony fails: no apply, no staging, no phantom state", async () => {
      const { identity, store, order } = harness({ shouldAppendFail: true });

      await expect(identity.attachIdentifier(attachData())).rejects.toThrow(
        "clickhouse unavailable",
      );
      expect(order).toEqual(["append"]);
      expect(store.stored.get(USER)).toBeUndefined();
    });
  });

  describe("when a guard vetoes the command", () => {
    it("nothing is appended, applied, or staged", async () => {
      const { identity, order } = harness();

      await expect(
        identity.detachIdentifier({
          tenantId: USER,
          userId: USER,
          commandId: "idcmd_d1",
          identifierId: "idf_missing",
          occurredAtMs: T0,
          actor: ACTOR,
        }),
      ).rejects.toMatchObject({ code: "identity_identifier_not_found" });
      expect(order).toEqual([]);
    });
  });

  describe("when the same command runs again after its fact was folded", () => {
    /** @scenario "A fact the heads already carry is not stated again" */
    it("appends, applies and stages nothing; the projection and cursor stand", async () => {
      const { identity, store, appended, staged, order } = harness();

      const events = await identity.attachIdentifier(attachData());
      const after = structuredClone(store.stored.get(USER)!);
      expect(events).toHaveLength(1);
      expect(appended).toHaveLength(1);
      order.length = 0;

      const rerun = await identity.attachIdentifier(attachData());
      expect(rerun).toEqual([]);
      expect(appended).toHaveLength(1);
      expect(staged).toHaveLength(1);
      expect(order).toEqual([]);
      expect(store.stored.get(USER)).toEqual(after);
    });
  });

  describe("when the projection is behind the durable append", () => {
    it("the re-run restates the fact and the cursor-guarded fold repairs the row", async () => {
      const { identity, store, appended } = harness();
      store.shouldFailNextStore = true;

      await identity.attachIdentifier(attachData());
      expect(store.stored.get(USER)).toBeUndefined();

      // The heads lack the fact, so the re-run states it again: the same
      // deterministic id and idempotency key, deduped on read.
      const restated = await identity.attachIdentifier(attachData());
      expect(restated).toHaveLength(1);
      expect((restated[0] as IdentityEvent).idempotencyKey).toBe(
        appended[0]![0]!.idempotencyKey,
      );
      expect(appended).toHaveLength(2);
      expect(
        Object.keys(store.stored.get(USER)!.state.identifiers),
      ).toHaveLength(1);
    });
  });
});
