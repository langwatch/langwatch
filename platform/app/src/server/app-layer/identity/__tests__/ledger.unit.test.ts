import {
  ATTACH_IDENTIFIER_COMMAND_TYPE,
  emptyIdentityHeads,
  type IdentifierFact,
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
  /** Rows the ledger wrote for a newborn before staging — kept apart from
   *  `stored` because that is the point: they carry no cursor. */
  readonly provisional = new Map<string, IdentifierFact>();
  /** Every leg, in the order it ran — the ledger's own writes and the
   *  simulated queue's, so a test can pin the sequence. */
  readonly order: string[] = [];

  async load(key: string, _context: ProjectionStoreContext) {
    return this.stored.get(key) ?? null;
  }

  async writeProvisionalHeads({ facts }: { facts: IdentifierFact[] }) {
    this.order.push("provisional");
    for (const fact of facts) this.provisional.set(fact.identifierId, fact);
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

  /** A cursor exists exactly when the fold has stored something. */
  async hasFolded({ userId }: { userId: string }) {
    return this.store.stored.has(userId);
  }

  async findActiveIdentifierByValue() {
    return null;
  }

  /** What Postgres would answer: the folded rows, plus any provisional ones
   *  the ledger wrote — the same table, and the guard cannot tell them apart
   *  by looking at the row. */
  async findHeads({ userId }: { userId: string }) {
    const stored = this.store.stored.get(userId);
    const folded = stored
      ? { userId, identifiers: stored.state.identifiers }
      : emptyIdentityHeads({ userId });
    const provisional = Object.fromEntries(
      [...this.store.provisional.values()]
        .filter((fact) => fact.userId === userId)
        .map((fact) => [fact.identifierId, fact]),
    );
    return {
      ...folded,
      identifiers: { ...provisional, ...folded.identifiers },
    };
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
  /** A store carried over from an earlier pass, rows and all. */
  store?: InMemoryStateStore;
}) {
  const store = overrides?.store ?? new InMemoryStateStore();
  const appended: IdentityEvent[][] = [];
  const staged: unknown[] = [];
  const order = store.order;
  const heads = new ProjectionHeads(store);
  const guards = new IdentityGuards(
    heads,
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
    heads,
    stagedSender: async () => (overrides?.noSender ? null : sender),
    convergence: { timeoutMs: 40, pollMs: 5 },
  });
  const identity = new IdentityService(guards, ledger);

  return { identity, store, heads, appended, staged, order, sender };
}

function attachData(overrides?: Record<string, unknown>) {
  return {
    tenantId: USER,
    userId: USER,
    commandId: "idcmd_1",
    accountId: null,
    provider: "google" as const,
    providerId: "google",
    // Google's real issuer, which is what better-auth keys the account by —
    // not the synthetic form a derivation from the provider id would give.
    issuer: "https://accounts.google.com",
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
      // "sam" has never folded, so the provisional row comes first; the
      // append is still the queued run's alone.
      expect(order).toEqual(["provisional", "stage", "append", "fold"]);
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

    it("never stores a projection itself — only the fold moves the cursor", async () => {
      const { identity, store } = harness();
      await identity.attachIdentifier(attachData());
      // The ledger reads the projection and writes a newborn's ROWS; every
      // `store` call — the one that carries a cursor — came from the fold.
      expect(store.storeContexts).toHaveLength(0);
    });
  });

  describe("when the user is a newborn whose projection has never folded", () => {
    /** @scenario "Signing up makes the address routable before the fold lands" */
    it("writes the identifier row before staging, with no cursor, and the fold overwrites it whole", async () => {
      const lagging = harness({ foldNeverLands: true });

      const events = await lagging.identity.attachIdentifier(attachData());

      // Routable already: the row is there while the command is still queued.
      const provisional = [...lagging.store.provisional.values()];
      expect(provisional).toHaveLength(1);
      expect(provisional[0]!.value).toBe("sam.j@acme.com");
      expect(provisional[0]!.state).toBe("VERIFIED");
      expect(lagging.order).toEqual(["provisional", "stage"]);
      // No cursor with it: nothing has folded, and nothing says otherwise.
      expect(lagging.store.stored.get(USER)).toBeUndefined();
      expect(await lagging.heads.hasFolded({ userId: USER })).toBe(false);

      // The queue drains: the fold writes the same row whole and sets the
      // cursor. Nothing about the row changes.
      foldInto(lagging.store, events);
      const folded = lagging.store.stored.get(USER)!;
      const identifierId = provisional[0]!.identifierId;
      expect(folded.state.identifiers[identifierId]).toEqual(
        lagging.store.provisional.get(identifierId),
      );
      expect(folded.cursor.eventId).toBe(events[0]!.id);
    });

    /** @scenario "A newborn's provisional head does not silence its own attach" */
    it("the queued re-run still appends and folds: the provisional row silences nothing", async () => {
      const { identity, store, appended, order } = harness();

      const events = await identity.attachIdentifier(attachData());

      // The queue re-ran the guard AGAINST the provisional row and still
      // stated the fact: one append, one fold, cursor at the event.
      expect(order).toEqual(["provisional", "stage", "append", "fold"]);
      expect(appended).toHaveLength(1);
      expect(events).toHaveLength(1);
      // The queued run minted its own event id for the same idempotency key;
      // the cursor sits at the event that was actually appended.
      expect(store.stored.get(USER)!.cursor.eventId).toBe(appended[0]![0]!.id);
    });

    it("a user who has folded gets no provisional write, and a restated attach still emits nothing", async () => {
      const { identity, store, order } = harness();
      await identity.attachIdentifier(attachData());
      store.provisional.clear();
      order.length = 0;

      const restated = await identity.attachIdentifier(
        attachData({ commandId: "backfill:acc_1" }),
      );
      expect(restated).toEqual([]);
      expect(order).toEqual([]);

      await identity.attachIdentifier(
        attachData({ commandId: "idcmd_2", providerAccountId: "gid_2" }),
      );
      expect(store.provisional.size).toBe(0);
      expect(order).toEqual(["stage", "append", "fold"]);
    });

    /** @scenario "A provisional head with no event is restated by the next pass" */
    it("a row left behind by failed staging has no event, and the next pass states the attach again", async () => {
      const first = harness({ shouldStagingFail: true });
      await expect(
        first.identity.attachIdentifier(attachData()),
      ).rejects.toThrow("redis unavailable");
      // The row is there; nothing is behind it. A replay before the next
      // pass rebuilds from events and would not rebuild this row.
      expect(first.store.provisional.size).toBe(1);
      expect(first.store.stored.get(USER)).toBeUndefined();
      expect(first.appended).toHaveLength(0);

      // The next pass, over the same rows, under the id the backfill derives.
      const next = harness({ store: first.store });
      const events = await next.identity.attachIdentifier(
        attachData({ commandId: "backfill:acc_1" }),
      );

      expect(events).toHaveLength(1);
      expect(next.appended).toHaveLength(1);
      expect(next.store.stored.get(USER)!.cursor.eventId).toBe(
        next.appended[0]![0]!.id,
      );
    });
  });

  describe("when GroupQueue staging fails", () => {
    /** @scenario "A ceremony whose command cannot be staged fails" */
    it("the ceremony fails, and nothing reached the log to be half-applied", async () => {
      const { identity, appended, order } = harness({
        shouldStagingFail: true,
      });

      await expect(identity.attachIdentifier(attachData())).rejects.toThrow(
        "redis unavailable",
      );
      expect(appended).toHaveLength(0);
      // The newborn's provisional row is the one thing left behind, by
      // design — see the newborn describe for what the next pass does with it.
      expect(order).toEqual(["provisional", "stage"]);
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
      expect(order).toEqual(["provisional", "stage", "append"]);
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
