import {
  ATTACH_IDENTIFIER_COMMAND_TYPE,
  emptyIdentityHeads,
  reduceIdentity,
} from "@langwatch/identity";
import {
  IdentityGuards,
  type IdentityHeadsRepository,
  IdentityService,
} from "@langwatch/identity-server";
import { describe, expect, it, vi } from "vitest";
import { identityEventsFor } from "~/server/event-sourcing/pipelines/identity/envelope";
import type { IdentityFoldState } from "~/server/event-sourcing/pipelines/identity/projections/identityState.foldProjection";
import type { IdentityEvent } from "~/server/event-sourcing/pipelines/identity/schemas/events";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import type {
  StateProjectionStore,
  StoredProjection,
} from "~/server/event-sourcing/projections/stateProjection.types";
import { IdentityLedgerWriter } from "../ledger";
import { identityProjectionConvergenceTimeoutsTotal } from "../metrics";
import {
  inMemoryIdentityReservations,
  inMemoryIdentityUsers,
} from "./support/identity-test-doubles";

const USER = "user_sam";
const ACTOR = { type: "user" as const, id: USER };
const T0 = 1_690_000_000_000;

class InMemoryStateStore implements StateProjectionStore<IdentityFoldState> {
  readonly stored = new Map<string, StoredProjection<IdentityFoldState>>();
  readonly storeContexts: ProjectionStoreContext[] = [];

  async load(key: string, _context: ProjectionStoreContext) {
    return this.stored.get(key) ?? null;
  }

  async store(
    projection: StoredProjection<IdentityFoldState>,
    context: ProjectionStoreContext,
  ) {
    this.storeContexts.push(context);
    this.stored.set(context.aggregateId, projection);
  }
}

/** The heads as the Prisma repository reads them: off the projection the
 *  QUEUE's fold wrote. Nothing else ever writes it. */
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

/**
 * What the queue's fold does when it drains the staged command: apply the
 * events to the user's projection and advance the cursor. The ledger never
 * does this itself — it only waits to observe it.
 */
function foldInto(store: InMemoryStateStore, events: IdentityEvent[]): void {
  const previous = store.stored.get(USER);
  let state: IdentityFoldState =
    previous?.state ??
    ({
      ...emptyIdentityHeads({ userId: USER }),
      CreatedAt: T0,
      UpdatedAt: T0,
      LastEventOccurredAt: T0,
    } as IdentityFoldState);
  let cursor = previous?.cursor ?? { acceptedAt: 0, eventId: "" };
  for (const event of events) {
    state = {
      ...state,
      ...reduceIdentity({ heads: state, fact: event }),
      userId: USER,
    } as IdentityFoldState;
    cursor = { acceptedAt: event.createdAt, eventId: event.id };
  }
  store.stored.set(USER, {
    state,
    cursor,
    occurredAt: events[events.length - 1]?.occurredAt ?? T0,
    createdAt: previous?.createdAt ?? T0,
    updatedAt: T0,
    version: "1",
  });
}

/**
 * The queue, standing in for the real one: it re-runs the SAME guard the
 * calling path ran, appends whatever that guard states, and folds it.
 *
 * That fidelity is the point of this harness. A sender that only recorded the
 * send would say nothing about the second appender — and the second appender
 * is exactly what "one event row per ceremony" is about.
 */
function harness(overrides?: {
  shouldAppendFail?: boolean;
  shouldStagingFail?: boolean;
  /** The queue never drains: the read-your-writes wait must expire. */
  foldNeverLands?: boolean;
  noSender?: boolean;
}) {
  const store = new InMemoryStateStore();
  const appended: IdentityEvent[][] = [];
  const staged: unknown[] = [];
  const order: string[] = [];
  const guards = new IdentityGuards(
    new ProjectionHeads(store),
    inMemoryIdentityUsers(),
    inMemoryIdentityReservations(),
  );

  const sender = {
    send: vi.fn(async (data: unknown) => {
      order.push("stage");
      if (overrides?.shouldStagingFail) throw new Error("redis unavailable");
      staged.push(data);
      if (overrides?.foldNeverLands) return undefined;
      const facts = await guards.attachIdentifier(
        data as Parameters<IdentityGuards["attachIdentifier"]>[0],
      );
      if (facts.length === 0) return undefined;
      const events = identityEventsFor({
        command: { type: ATTACH_IDENTIFIER_COMMAND_TYPE, data: data as never },
        facts,
      });
      order.push("append");
      if (overrides?.shouldAppendFail) {
        throw new Error("clickhouse unavailable");
      }
      appended.push(events);
      order.push("fold");
      foldInto(store, events);
      return undefined;
    }),
  };

  const ledger = new IdentityLedgerWriter({
    projectionStore: store,
    stagedSender: async () => (overrides?.noSender ? null : sender),
    convergence: { timeoutMs: 40, pollMs: 5 },
  });
  const identity = new IdentityService(guards, ledger);

  return { identity, store, appended, staged, order, sender };
}

function attachData(overrides?: Record<string, unknown>) {
  return {
    tenantId: USER,
    userId: USER,
    commandId: "idcmd_1",
    accountId: null,
    provider: "google" as const,
    providerId: "google",
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
    /** @scenario "An identity ceremony stages its command and waits for the fold" */
    it("stages the command, and the staged run is the only thing that appends", async () => {
      const { identity, store, appended, staged, order } = harness();

      const events = await identity.attachIdentifier(attachData());

      expect(events).toHaveLength(1);
      expect(order).toEqual(["stage", "append", "fold"]);
      expect(staged).toHaveLength(1);
      // Exactly one event row for one ceremony: the calling path decided the
      // facts, the queued run wrote them, and nobody wrote them twice.
      expect(appended).toHaveLength(1);
      expect(appended[0]).toHaveLength(1);

      // Read-your-writes: the wait returned only once the fold had landed.
      const projection = store.stored.get(USER)!;
      const facts = Object.values(projection.state.identifiers);
      expect(facts[0]!.value).toBe("sam.j@acme.com");
      expect(projection.cursor.eventId).toBe(
        (appended[0]?.[0] as IdentityEvent).id,
      );
    });

    it("stages the COMMAND, not the facts: the queue re-runs the guard", async () => {
      const { identity, staged } = harness();
      await identity.attachIdentifier(attachData());
      expect(staged[0]).toMatchObject({
        commandId: "idcmd_1",
        value: "Sam.J@Acme.com",
      });
    });

    it("never writes the projection itself — only the fold does", async () => {
      const { identity, store } = harness();
      await identity.attachIdentifier(attachData());
      // The ledger's only projection access is `load`; every `store` call in
      // this harness came from the simulated fold.
      expect(store.storeContexts).toHaveLength(0);
    });
  });

  describe("when GroupQueue staging fails", () => {
    /** @scenario "A ceremony whose command cannot be staged fails" */
    it("the ceremony fails, and nothing was written to be half-applied", async () => {
      const { identity, appended, order } = harness({
        shouldStagingFail: true,
      });

      await expect(identity.attachIdentifier(attachData())).rejects.toThrow(
        "redis unavailable",
      );
      expect(appended).toHaveLength(0);
      expect(order).toEqual(["stage"]);
    });
  });

  describe("when the pipeline exposes no sender for the command", () => {
    it("fails loudly: a wiring defect, never a silent drop", async () => {
      const { identity } = harness({ noSender: true });

      await expect(identity.attachIdentifier(attachData())).rejects.toThrow(
        /exposes no "attachIdentifier" sender/,
      );
    });
  });

  describe("when the fold does not land inside the convergence window", () => {
    /** @scenario "A lagging fold does not fail the ceremony" */
    it("the ceremony still succeeds, and the timeout is counted", async () => {
      const { identity, staged } = harness({ foldNeverLands: true });
      const before = await counterValue(
        identityProjectionConvergenceTimeoutsTotal,
      );

      const events = await identity.attachIdentifier(attachData());

      expect(events).toHaveLength(1);
      expect(staged).toHaveLength(1);
      expect(
        await counterValue(identityProjectionConvergenceTimeoutsTotal),
      ).toBe(before + 1);
    });
  });

  describe("when the queued append itself fails", () => {
    it("the ceremony fails: no phantom state anywhere", async () => {
      const { identity, store, order } = harness({ shouldAppendFail: true });

      await expect(identity.attachIdentifier(attachData())).rejects.toThrow(
        "clickhouse unavailable",
      );
      expect(order).toEqual(["stage", "append"]);
      expect(store.stored.get(USER)).toBeUndefined();
    });
  });

  describe("when a guard vetoes the command", () => {
    it("nothing is appended or staged", async () => {
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
    it("appends and stages nothing; the projection and cursor stand", async () => {
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
});
