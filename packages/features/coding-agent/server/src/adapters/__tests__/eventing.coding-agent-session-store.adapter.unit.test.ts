/**
 * The store adapter's half of the durable dedup watermark (ADR-066): it
 * threads `context.appliedEventIds` into the persistence write, and reads
 * the set back through `getWithApplied` so a retry with a cold cache can
 * recognise a batch it already committed. `get()` delegates to
 * `getWithApplied` so the two read paths cannot diverge.
 *
 * @see specs/coding-agent/session-aggregate.feature
 */
import { createTenantId, type ProjectionStoreContext } from "@langwatch/eventing";
import type {
  CodingAgentProjectionPersistence,
  CodingAgentSession,
} from "@langwatch/coding-agent-contract";
import { describe, expect, it } from "vitest";
import { EventingCodingAgentSessionStoreAdapter } from "../eventing.coding-agent-session-store.adapter";
import {
  CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
  CODING_AGENT_SESSION_PROJECTION_VERSION_PRE_STAMP,
  CodingAgentSessionRowMapper,
  type CodingAgentSessionRow,
  type CodingAgentSessionState,
} from "../../projections/coding-agent-session.projection";
import { CodingAgentSessionStateProjection } from "../../projections/coding-agent-session-state.projection";

const tenantId = createTenantId("tenant-1");

function makeState(over: Partial<CodingAgentSessionState> = {}): CodingAgentSessionState {
  return {
    ...CodingAgentSessionStateProjection.create().createInitCodingAgentSession(),
    sessionKeySource: "provider",
    traceIds: [],
    startedAtMs: 1_000,
    createdAt: 1_000,
    updatedAt: 1_000,
    LastEventOccurredAt: 1_000,
    // One prompt, so the state passes the persist gate: a session that never
    // said anything stores no row, and these suites are about what a stored
    // row carries, not about the gate.
    prompts: 1,
    ...over,
  };
}

function makeRow(state: CodingAgentSessionState): CodingAgentSessionRow {
  return CodingAgentSessionRowMapper.toRow({
    state,
    tenantId: String(tenantId),
    sessionId: "session-1",
    version: CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
  });
}

/** Fake persistence port capturing writes and answering the read-back query. */
class FakePersistence implements CodingAgentProjectionPersistence {
  upsertCalls: Array<{
    row: CodingAgentSession;
    retentionDays: number;
    appliedEventIds: readonly string[];
  }> = [];
  batchEntries: Array<{
    row: CodingAgentSession;
    retentionDays: number;
    appliedEventIds: readonly string[];
  }> = [];
  withApplied: { row: CodingAgentSession; appliedEventIds: string[] } | null = null;
  lastFindParams:
    | { tenantId: string; sessionId: string; window?: { fromMs: number; toMs: number } }
    | undefined;

  async storeSession(input: {
    row: CodingAgentSession;
    retentionDays: number;
    appliedEventIds: readonly string[];
  }): Promise<void> {
    this.upsertCalls.push(input);
  }

  async storeSessionBatch(
    entries: Array<{
      row: CodingAgentSession;
      retentionDays: number;
      appliedEventIds: readonly string[];
    }>,
  ): Promise<void> {
    this.batchEntries.push(...entries);
  }

  async loadSessionWithApplied(params: {
    tenantId: string;
    sessionId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<{ row: CodingAgentSession; appliedEventIds: string[] } | null> {
    this.lastFindParams = params;
    return this.withApplied;
  }

  async appendTraceSessions(): Promise<void> {}
  async appendMetricSeries(): Promise<void> {}
  async appendSessionEvents(): Promise<void> {}
}

const context = (over: Partial<ProjectionStoreContext> = {}): ProjectionStoreContext => ({
  aggregateId: "session-1",
  tenantId,
  ...over,
});

function storeWith(
  persistence: FakePersistence,
  hooks: { onSessionsStored?: (tenantIds: string[]) => Promise<void> } = {},
): EventingCodingAgentSessionStoreAdapter {
  return EventingCodingAgentSessionStoreAdapter.create({
    persistence,
    defaultRetentionDays: 30,
    onSessionsStored: hooks.onSessionsStored,
  });
}

describe("the session persist gate", () => {
  describe("given a session that emitted only lifecycle and error telemetry", () => {
    /** @scenario "Lifecycle-only telemetry creates no session row" */
    it("stores no row", async () => {
      const persistence = new FakePersistence();
      const store = storeWith(persistence);

      await store.store(
        makeState({ prompts: 0, apiErrors: 4 }),
        context({ appliedEventIds: ["e1"] }),
      );

      expect(persistence.upsertCalls).toEqual([]);
    });

    it("drops such entries from a batch and keeps the rest", async () => {
      const persistence = new FakePersistence();
      const store = storeWith(persistence);

      await store.storeBatch([
        { state: makeState({ prompts: 0, apiErrors: 4 }), context: context() },
        { state: makeState(), context: context() },
      ]);

      expect(persistence.batchEntries).toHaveLength(1);
      expect(persistence.batchEntries[0]!.row.prompts).toBe(1);
    });
  });

  describe("given the session's first real signal", () => {
    /** @scenario "The first real signal creates the row" */
    it("a prompt stores the row", async () => {
      const persistence = new FakePersistence();
      const store = storeWith(persistence);

      await store.store(makeState({ prompts: 1 }), context());

      expect(persistence.upsertCalls).toHaveLength(1);
    });

    /** @scenario "A session announced with a name is a row from the start" */
    it("the session's own name stores the row before any prompt", async () => {
      const persistence = new FakePersistence();
      const store = storeWith(persistence);

      await store.store(
        makeState({ prompts: 0, title: "pr-reviewer", titleSource: "name" }),
        context(),
      );

      expect(persistence.upsertCalls).toHaveLength(1);
      expect(persistence.upsertCalls[0]!.row.title).toBe("pr-reviewer");
    });

    /** @scenario "a session that sent only metrics still appears" */
    it("a metrics-only session with tokens stores the row", async () => {
      const persistence = new FakePersistence();
      const store = storeWith(persistence);

      await store.store(makeState({ prompts: 0, inputTokens: 1_200, outputTokens: 90 }), context());

      expect(persistence.upsertCalls).toHaveLength(1);
    });
  });
});

describe("EventingCodingAgentSessionStoreAdapter durable dedup", () => {
  describe("given a fold step commits state", () => {
    describe("when the context carries applied event ids", () => {
      it("forwards them to the repository upsert as the durable watermark", async () => {
        const persistence = new FakePersistence();
        const store = storeWith(persistence);

        await store.store(makeState(), context({ appliedEventIds: ["e1", "e2"] }));

        expect(persistence.upsertCalls).toHaveLength(1);
        expect(persistence.upsertCalls[0]!.appliedEventIds).toEqual(["e1", "e2"]);
      });
    });

    describe("when the context carries no applied event ids", () => {
      it("forwards an empty watermark rather than omitting it", async () => {
        const persistence = new FakePersistence();
        const store = storeWith(persistence);

        await store.store(makeState(), context());

        expect(persistence.upsertCalls[0]!.appliedEventIds).toEqual([]);
      });
    });
  });

  describe("given a batch commits several states", () => {
    describe("when each entry carries its own applied event ids", () => {
      it("forwards each entry's watermark to the batch write", async () => {
        const persistence = new FakePersistence();
        const store = storeWith(persistence);

        await store.storeBatch([
          { state: makeState(), context: context({ appliedEventIds: ["e1"] }) },
          {
            state: makeState(),
            context: context({ aggregateId: "session-2", appliedEventIds: ["e2", "e3"] }),
          },
        ]);

        expect(persistence.batchEntries.map((e) => e.appliedEventIds)).toEqual([
          ["e1"],
          ["e2", "e3"],
        ]);
      });
    });
  });

  describe("given the store carries the sessions-stored hook", () => {
    describe("when a fold step commits", () => {
      it("reports the committed tenant after the durable write", async () => {
        const persistence = new FakePersistence();
        const seen: string[][] = [];
        const store = storeWith(persistence, {
          onSessionsStored: async (tenantIds) => {
            // The row must be durable before the project is stamped.
            expect(persistence.upsertCalls).toHaveLength(1);
            seen.push(tenantIds);
          },
        });

        await store.store(makeState(), context());
        await Promise.resolve();

        expect(seen).toEqual([[String(tenantId)]]);
      });
    });

    describe("when a batch commits several sessions of one project", () => {
      it("reports the tenant once, not once per session", async () => {
        const persistence = new FakePersistence();
        const seen: string[][] = [];
        const store = storeWith(persistence, {
          onSessionsStored: async (tenantIds) => {
            seen.push(tenantIds);
          },
        });

        await store.storeBatch([
          { state: makeState(), context: context() },
          { state: makeState(), context: context({ aggregateId: "session-2" }) },
        ]);
        await Promise.resolve();

        expect(seen).toEqual([[String(tenantId)]]);
      });
    });

    describe("when the hook rejects anyway", () => {
      // The touch helper never rejects by contract; this pins that a
      // misbehaving hook still cannot fail the committed fold write.
      it("does not fail the store call", async () => {
        const persistence = new FakePersistence();
        const store = storeWith(persistence, {
          onSessionsStored: () => Promise.reject(new Error("boom")),
        });

        await expect(store.store(makeState(), context())).resolves.toBeUndefined();
      });
    });
  });

  describe("given the read-back store holds a committed session", () => {
    describe("when the fold reads the state with its watermark", () => {
      /** @scenario a redelivered batch after a committed write does not double-count */
      it("maps the row to state and returns the persisted watermark", async () => {
        const persistence = new FakePersistence();
        const state = makeState({ modelCalls: 3 });
        persistence.withApplied = { row: makeRow(state), appliedEventIds: ["e1", "e2"] };
        const store = storeWith(persistence);

        const result = await store.getWithApplied(
          "session-1",
          context({ readWindow: { fromMs: 4_000, toMs: 5_000 } }),
        );

        expect(result.state?.modelCalls).toBe(3);
        expect(result.appliedEventIds).toEqual(["e1", "e2"]);
        // The executor-computed window is threaded through verbatim as the
        // partition-pruning bound.
        expect(persistence.lastFindParams?.window).toEqual({ fromMs: 4_000, toMs: 5_000 });
      });
    });

    describe("when the session has never been folded", () => {
      it("returns null state and an empty watermark", async () => {
        const persistence = new FakePersistence();
        persistence.withApplied = null;
        const store = storeWith(persistence);

        const result = await store.getWithApplied("session-1", context());

        expect(result.state).toBeNull();
        expect(result.appliedEventIds).toEqual([]);
      });
    });
  });

  describe("given get() is called", () => {
    describe("when a committed session exists", () => {
      it("delegates to getWithApplied and returns state only", async () => {
        const persistence = new FakePersistence();
        const state = makeState({ modelCalls: 7 });
        persistence.withApplied = { row: makeRow(state), appliedEventIds: ["e1"] };
        const store = storeWith(persistence);

        const result = await store.get("session-1", context());

        expect(result?.modelCalls).toBe(7);
      });
    });
  });
});

/**
 * The read-back gate (ADR-066). The columns of migrations 00053/00054 are only
 * trustworthy on a row written after 00053 applied; on an older row each decodes
 * as a ClickHouse default indistinguishable from a real value, so the store
 * reports a miss and the fold's `refoldOnStoreMiss` rebuilds it once.
 */
describe("EventingCodingAgentSessionStoreAdapter read-back gate", () => {
  /** A session with every read-back column carrying real, non-default values. */
  function committedState(): CodingAgentSessionState {
    return makeState({
      modelCalls: 3,
      subAgents: 2,
      subAgentIds: ["sub-a", "sub-b"],
      previousCallContextTokens: 12_000,
      steps: [{ name: "Read", count: 2, failed: false, startedAtMs: 9_000 }],
      metricSeries: {
        "loc-added": {
          metricName: "claude_code.lines_of_code.count",
          type: "added",
          decision: null,
          language: null,
          value: 42,
        },
      },
      linesAdded: 42,
    });
  }

  describe("given a row stamped with the current projection version", () => {
    describe("when the fold reads it back", () => {
      /** @scenario a stored state written under the fold's current shape is read straight back */
      it("returns the decoded state and the durable watermark", async () => {
        const persistence = new FakePersistence();
        persistence.withApplied = { row: makeRow(committedState()), appliedEventIds: ["e1", "e2"] };
        const store = storeWith(persistence);

        const { state, appliedEventIds } = await store.getWithApplied("session-1", context());

        expect(state?.subAgentIds).toEqual(["sub-a", "sub-b"]);
        expect(state?.steps[0]?.startedAtMs).toBe(9_000);
        expect(Object.keys(state?.metricSeries ?? {})).toEqual(["loc-added"]);
        expect(appliedEventIds).toEqual(["e1", "e2"]);
      });
    });
  });

  describe("given a row stamped with an older projection version", () => {
    const staleRow = (): CodingAgentSessionRow => ({
      ...makeRow(committedState()),
      version: CODING_AGENT_SESSION_PROJECTION_VERSION_PRE_STAMP,
      subAgentIds: [],
      stepStartedAt: [],
      previousCallContextTokens: 0,
      metricSeries: [],
      lastEventOccurredAt: 0,
    });

    describe("when the fold reads it back", () => {
      /** @scenario a stored state written under an older shape is rebuilt rather than trusted */
      it("reports a store miss so the fold rebuilds instead of trusting it", async () => {
        const persistence = new FakePersistence();
        persistence.withApplied = { row: staleRow(), appliedEventIds: ["e1", "e2"] };
        const store = storeWith(persistence);

        const { state, appliedEventIds, miss } = await store.getWithApplied("session-1", context());

        expect(state).toBeNull();
        // The watermark goes with the state: keeping it would suppress the very
        // events the re-fold needs to see.
        expect(appliedEventIds).toEqual([]);
        expect(miss).toBe("undecodable");
      });

      it("misses through get() too, so both read paths agree", async () => {
        const persistence = new FakePersistence();
        persistence.withApplied = { row: staleRow(), appliedEventIds: ["e1"] };
        const store = storeWith(persistence);

        expect(await store.get("session-1", context())).toBeNull();
      });
    });
  });

  describe("given a rebuilt aggregate's state committed at the current version", () => {
    describe("when it is read back", () => {
      /** @scenario rebuilding an aggregate once retires it from rebuilding again */
      it("returns the committed state rather than reporting a miss", async () => {
        const persistence = new FakePersistence();
        const store = storeWith(persistence);

        await store.store(committedState(), context({ appliedEventIds: ["e1", "e2"] }));
        const written = persistence.upsertCalls[0]!;
        persistence.withApplied = {
          row: written.row,
          appliedEventIds: [...written.appliedEventIds],
        };

        const { state, appliedEventIds, miss } = await store.getWithApplied("session-1", context());

        expect(miss).toBeUndefined();
        expect(state?.subAgentIds).toEqual(["sub-a", "sub-b"]);
        expect(state?.previousCallContextTokens).toBe(12_000);
        expect(appliedEventIds).toEqual(["e1", "e2"]);
      });
    });
  });

  describe("given a pre-bump row whose read-back columns are populated", () => {
    const preBumpRow = (): CodingAgentSessionRow => ({
      ...makeRow(committedState()),
      version: CODING_AGENT_SESSION_PROJECTION_VERSION_PRE_STAMP,
      lastEventOccurredAt: 1_900,
    });

    describe("when the fold reads it back", () => {
      it("decodes it rather than forcing a full-history refold", async () => {
        const persistence = new FakePersistence();
        persistence.withApplied = { row: preBumpRow(), appliedEventIds: ["e1", "e2"] };
        const store = storeWith(persistence);

        const { state, appliedEventIds } = await store.getWithApplied("session-1", context());

        expect(state?.subAgentIds).toEqual(["sub-a", "sub-b"]);
        expect(state?.steps[0]?.startedAtMs).toBe(9_000);
        expect(state?.previousCallContextTokens).toBe(12_000);
        expect(appliedEventIds).toEqual(["e1", "e2"]);
      });
    });
  });

  describe("given a row on neither the current nor the pre-bump stamp", () => {
    describe("when the fold reads it back", () => {
      it("misses regardless of its checkpoint", async () => {
        // A populated checkpoint only rehabilitates the ONE stamp that is known
        // to straddle the column change. Any other stamp is a shape this build
        // has never reasoned about, so it refolds.
        const persistence = new FakePersistence();
        persistence.withApplied = {
          row: { ...makeRow(committedState()), version: "2020-01-01", lastEventOccurredAt: 1_900 },
          appliedEventIds: ["e1"],
        };
        const store = storeWith(persistence);

        expect(await store.get("session-1", context())).toBeNull();
      });
    });
  });
});
