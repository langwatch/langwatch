import { describe, expect, it } from "vitest";
import type {
  CodingAgentBranchSessionRow,
  CodingAgentSessionRepository,
} from "~/server/app-layer/coding-agent/repositories/coding-agent-session.repository";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import { createInitCodingAgentSession } from "../../services/coding-agent-session.derivation";
import {
  CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
  type CodingAgentSessionRow,
  type CodingAgentSessionState,
  projectCodingAgentSessionToRow,
} from "../codingAgentSession.foldProjection";
import { CodingAgentSessionStore } from "../codingAgentSession.store";

/**
 * The store adapter's half of the durable dedup watermark (ADR-066): it threads
 * `context.appliedEventIds` into the repository write, and reads the set back
 * through `getWithApplied` so a retry with a cold cache can recognise a batch it
 * already committed. `get()` delegates to `getWithApplied` so the two read paths
 * cannot diverge.
 */
const tenantId = createTenantId("tenant-1");

function makeState(
  over: Partial<CodingAgentSessionState> = {},
): CodingAgentSessionState {
  return {
    ...createInitCodingAgentSession(),
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
  return projectCodingAgentSessionToRow({
    state,
    tenantId: String(tenantId),
    sessionId: "session-1",
    version: CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
  });
}

/** Fake repository capturing writes and answering the read-back query. */
class FakeRepo implements CodingAgentSessionRepository {
  upsertCalls: Array<{
    row: CodingAgentSessionRow;
    retentionDays?: number;
    appliedEventIds?: readonly string[];
  }> = [];
  batchEntries: Array<{
    row: CodingAgentSessionRow;
    retentionDays?: number;
    appliedEventIds?: readonly string[];
  }> = [];
  withApplied: {
    row: CodingAgentSessionRow;
    appliedEventIds: string[];
  } | null = null;
  lastFindParams:
    | {
        tenantId: string;
        sessionId: string;
        window?: { fromMs: number; toMs: number };
      }
    | undefined;

  async upsert(
    row: CodingAgentSessionRow,
    retentionDays?: number,
    appliedEventIds?: readonly string[],
  ): Promise<void> {
    this.upsertCalls.push({ row, retentionDays, appliedEventIds });
  }

  async upsertBatch(
    entries: Array<{
      row: CodingAgentSessionRow;
      retentionDays?: number;
      appliedEventIds?: readonly string[];
    }>,
  ): Promise<void> {
    this.batchEntries.push(...entries);
  }

  async findBySessionId(): Promise<CodingAgentSessionRow | null> {
    return this.withApplied?.row ?? null;
  }

  async findBySessionIdWithApplied(params: {
    tenantId: string;
    sessionId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<{
    row: CodingAgentSessionRow;
    appliedEventIds: string[];
  } | null> {
    this.lastFindParams = params;
    return this.withApplied;
  }

  async findManyRecent(): Promise<CodingAgentSessionRow[]> {
    return [];
  }

  async listByRepositoryBranch(): Promise<CodingAgentBranchSessionRow[]> {
    return [];
  }
}

const context = (
  over: Partial<ProjectionStoreContext> = {},
): ProjectionStoreContext => ({
  aggregateId: "session-1",
  tenantId,
  ...over,
});

describe("the session persist gate", () => {
  describe("given a session that emitted only lifecycle and error telemetry", () => {
    /** @scenario "Lifecycle-only telemetry creates no session row" */
    it("stores no row", async () => {
      const repo = new FakeRepo();
      const store = new CodingAgentSessionStore(repo);

      await store.store(
        makeState({ prompts: 0, apiErrors: 4 }),
        context({ appliedEventIds: ["e1"] }),
      );

      expect(repo.upsertCalls).toEqual([]);
    });

    it("drops such entries from a batch and keeps the rest", async () => {
      const repo = new FakeRepo();
      const store = new CodingAgentSessionStore(repo);

      await store.storeBatch([
        { state: makeState({ prompts: 0, apiErrors: 4 }), context: context() },
        { state: makeState(), context: context() },
      ]);

      expect(repo.batchEntries).toHaveLength(1);
      expect(repo.batchEntries[0]!.row.prompts).toBe(1);
    });
  });

  describe("given the session's first real signal", () => {
    /** @scenario "The first real signal creates the row" */
    it("a prompt stores the row", async () => {
      const repo = new FakeRepo();
      const store = new CodingAgentSessionStore(repo);

      await store.store(makeState({ prompts: 1 }), context());

      expect(repo.upsertCalls).toHaveLength(1);
    });

    /** @scenario "A session announced with a name is a row from the start" */
    it("an orchestrator-declared title stores the row before any prompt", async () => {
      const repo = new FakeRepo();
      const store = new CodingAgentSessionStore(repo);

      await store.store(
        makeState({ prompts: 0, titleExplicit: "pr-reviewer" }),
        context(),
      );

      expect(repo.upsertCalls).toHaveLength(1);
      expect(repo.upsertCalls[0]!.row.titleExplicit).toBe("pr-reviewer");
    });

    /** @scenario "a session that sent only metrics still appears" */
    it("a metrics-only session with tokens stores the row", async () => {
      const repo = new FakeRepo();
      const store = new CodingAgentSessionStore(repo);

      await store.store(
        makeState({ prompts: 0, inputTokens: 1_200, outputTokens: 90 }),
        context(),
      );

      expect(repo.upsertCalls).toHaveLength(1);
    });
  });
});

describe("CodingAgentSessionStore durable dedup", () => {
  describe("given a fold step commits state", () => {
    describe("when the context carries applied event ids", () => {
      it("forwards them to the repository upsert as the durable watermark", async () => {
        const repo = new FakeRepo();
        const store = new CodingAgentSessionStore(repo);

        await store.store(
          makeState(),
          context({ appliedEventIds: ["e1", "e2"] }),
        );

        expect(repo.upsertCalls).toHaveLength(1);
        expect(repo.upsertCalls[0]!.appliedEventIds).toEqual(["e1", "e2"]);
      });
    });

    describe("when the context carries no applied event ids", () => {
      it("forwards an empty watermark rather than omitting it", async () => {
        const repo = new FakeRepo();
        const store = new CodingAgentSessionStore(repo);

        await store.store(makeState(), context());

        expect(repo.upsertCalls[0]!.appliedEventIds).toEqual([]);
      });
    });
  });

  describe("given a batch commits several states", () => {
    describe("when each entry carries its own applied event ids", () => {
      it("forwards each entry's watermark to the batch write", async () => {
        const repo = new FakeRepo();
        const store = new CodingAgentSessionStore(repo);

        await store.storeBatch([
          {
            state: makeState(),
            context: context({ appliedEventIds: ["e1"] }),
          },
          {
            state: makeState(),
            context: context({
              aggregateId: "session-2",
              appliedEventIds: ["e2", "e3"],
            }),
          },
        ]);

        expect(repo.batchEntries.map((e) => e.appliedEventIds)).toEqual([
          ["e1"],
          ["e2", "e3"],
        ]);
      });
    });
  });

  describe("given the store carries the sessions-stored hook", () => {
    describe("when a fold step commits", () => {
      it("reports the committed tenant after the durable write", async () => {
        const repo = new FakeRepo();
        const seen: string[][] = [];
        const store = new CodingAgentSessionStore(repo, {
          onSessionsStored: async (tenantIds) => {
            // The row must be durable before the project is stamped.
            expect(repo.upsertCalls).toHaveLength(1);
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
        const repo = new FakeRepo();
        const seen: string[][] = [];
        const store = new CodingAgentSessionStore(repo, {
          onSessionsStored: async (tenantIds) => {
            seen.push(tenantIds);
          },
        });

        await store.storeBatch([
          { state: makeState(), context: context() },
          {
            state: makeState(),
            context: context({ aggregateId: "session-2" }),
          },
        ]);
        await Promise.resolve();

        expect(seen).toEqual([[String(tenantId)]]);
      });
    });

    describe("when the hook rejects anyway", () => {
      // The touch helper never rejects by contract; this pins that a
      // misbehaving hook still cannot fail the committed fold write.
      it("does not fail the store call", async () => {
        const repo = new FakeRepo();
        const store = new CodingAgentSessionStore(repo, {
          onSessionsStored: () => Promise.reject(new Error("boom")),
        });

        await expect(
          store.store(makeState(), context()),
        ).resolves.toBeUndefined();
      });
    });
  });

  describe("given the read-back store holds a committed session", () => {
    describe("when the fold reads the state with its watermark", () => {
      /** @scenario a redelivered batch after a committed write does not double-count */
      it("maps the row to state and returns the persisted watermark", async () => {
        const repo = new FakeRepo();
        const state = makeState({ modelCalls: 3 });
        repo.withApplied = {
          row: makeRow(state),
          appliedEventIds: ["e1", "e2"],
        };
        const store = new CodingAgentSessionStore(repo);

        const result = await store.getWithApplied(
          "session-1",
          context({ readWindow: { fromMs: 4_000, toMs: 5_000 } }),
        );

        expect(result.state?.modelCalls).toBe(3);
        expect(result.appliedEventIds).toEqual(["e1", "e2"]);
        // The executor-computed window is threaded through verbatim as the
        // partition-pruning bound.
        expect(repo.lastFindParams?.window).toEqual({
          fromMs: 4_000,
          toMs: 5_000,
        });
      });
    });

    describe("when the session has never been folded", () => {
      it("returns null state and an empty watermark", async () => {
        const repo = new FakeRepo();
        repo.withApplied = null;
        const store = new CodingAgentSessionStore(repo);

        const result = await store.getWithApplied("session-1", context());

        expect(result.state).toBeNull();
        expect(result.appliedEventIds).toEqual([]);
      });
    });
  });

  describe("given get() is called", () => {
    describe("when a committed session exists", () => {
      it("delegates to getWithApplied and returns state only", async () => {
        const repo = new FakeRepo();
        const state = makeState({ modelCalls: 7 });
        repo.withApplied = { row: makeRow(state), appliedEventIds: ["e1"] };
        const store = new CodingAgentSessionStore(repo);

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
 *
 * The version alone cannot tell those apart. 00053 and 00054 shipped WITHOUT
 * bumping the stamp, so `2026-07-21` covers rows on both sides of the column
 * change. The gate therefore pairs it with the `LastEventOccurredAt` checkpoint,
 * which arrived in 00053, defaults to 0, and only ever takes a positive
 * `occurredAt` — 0 on every pre-00053 row and positive on every later one, by
 * construction.
 */
describe("CodingAgentSessionStore read-back gate", () => {
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
        const repo = new FakeRepo();
        repo.withApplied = {
          row: makeRow(committedState()),
          appliedEventIds: ["e1", "e2"],
        };
        const store = new CodingAgentSessionStore(repo);

        const { state, appliedEventIds } = await store.getWithApplied(
          "session-1",
          context(),
        );

        expect(state?.subAgentIds).toEqual(["sub-a", "sub-b"]);
        expect(state?.steps[0]?.startedAtMs).toBe(9_000);
        expect(Object.keys(state?.metricSeries ?? {})).toEqual(["loc-added"]);
        expect(appliedEventIds).toEqual(["e1", "e2"]);
      });
    });
  });

  describe("given a row stamped with an older projection version", () => {
    /**
     * Such a row predates the read-back columns, so each one carries its column
     * default: an empty metric-series map makes the next contribution recompute
     * every metric-fed total from that one series alone, an empty sub-agent id
     * set resets the count to one, zeroed step start times leave later steps
     * only their arrival order to be placed by, and a zeroed previous context
     * size reads as "first call ever" so the next cache rebuild goes uncounted.
     */
    const staleRow = (): CodingAgentSessionRow => ({
      ...makeRow(committedState()),
      version: "2026-07-21",
      subAgentIds: [],
      stepStartedAt: [],
      previousCallContextTokens: 0,
      metricSeries: [],
      lastEventOccurredAt: 0,
    });

    describe("when the fold reads it back", () => {
      /** @scenario a stored state written under an older shape is rebuilt rather than trusted */
      it("reports a store miss so the fold rebuilds instead of trusting it", async () => {
        const repo = new FakeRepo();
        repo.withApplied = {
          row: staleRow(),
          appliedEventIds: ["e1", "e2"],
        };
        const store = new CodingAgentSessionStore(repo);

        const { state, appliedEventIds, miss } = await store.getWithApplied(
          "session-1",
          context(),
        );

        expect(state).toBeNull();
        // The watermark goes with the state: keeping it would suppress the very
        // events the re-fold needs to see.
        expect(appliedEventIds).toEqual([]);
        // Asserted on the REAL store. The executor skips its unwindowed
        // re-read on `undecodable`; without this the only test naming the
        // value fabricated it from a mock, so deleting the discriminator
        // here left the suite green.
        expect(miss).toBe("undecodable");
      });

      it("misses through get() too, so both read paths agree", async () => {
        const repo = new FakeRepo();
        repo.withApplied = { row: staleRow(), appliedEventIds: ["e1"] };
        const store = new CodingAgentSessionStore(repo);

        expect(await store.get("session-1", context())).toBeNull();
      });
    });
  });

  describe("given a rebuilt aggregate's state committed at the current version", () => {
    describe("when it is read back", () => {
      /** @scenario rebuilding an aggregate once retires it from rebuilding again */
      it("returns the committed state rather than reporting a miss", async () => {
        const repo = new FakeRepo();
        const store = new CodingAgentSessionStore(repo);

        // Stands in for the re-fold's commit: whatever version the refused
        // row wore, the rewrite carries the current one. The refold itself
        // belongs to the executor and is exercised there — what matters here
        // is that the rewritten row reads back, which is what retires it.
        await store.store(
          committedState(),
          context({ appliedEventIds: ["e1", "e2"] }),
        );
        const written = repo.upsertCalls[0]!;
        repo.withApplied = {
          row: written.row,
          appliedEventIds: [...(written.appliedEventIds ?? [])],
        };

        const { state, appliedEventIds, miss } = await store.getWithApplied(
          "session-1",
          context(),
        );

        // Asserted explicitly, because the executor cannot catch this one:
        // `loadWithApplied` returns as soon as a state is present, so a
        // result carrying BOTH a state and a miss is read as a plain success
        // and the miss is never looked at again. A store that reported one
        // would go unnoticed everywhere else.
        expect(miss).toBeUndefined();
        expect(state?.subAgentIds).toEqual(["sub-a", "sub-b"]);
        expect(state?.previousCallContextTokens).toBe(12_000);
        expect(appliedEventIds).toEqual(["e1", "e2"]);
      });
    });
  });

  describe("given a pre-bump row whose read-back columns are populated", () => {
    /**
     * The population migrations 00053/00054 created without a stamp bump: rows
     * written by a build that HAD the read-back columns, still carrying
     * `2026-07-21` because neither migration touched the version. Rejecting
     * these on the version alone would refold a large live population from full
     * `event_log` history for no gain — the exact cost ADR-066 exists to remove,
     * on the aggregate class behind the 2026-07-23 outage.
     */
    const preBumpRow = (): CodingAgentSessionRow => ({
      ...makeRow(committedState()),
      version: "2026-07-21",
      lastEventOccurredAt: 1_900,
    });

    describe("when the fold reads it back", () => {
      it("decodes it rather than forcing a full-history refold", async () => {
        const repo = new FakeRepo();
        repo.withApplied = {
          row: preBumpRow(),
          appliedEventIds: ["e1", "e2"],
        };
        const store = new CodingAgentSessionStore(repo);

        const { state, appliedEventIds } = await store.getWithApplied(
          "session-1",
          context(),
        );

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
        const repo = new FakeRepo();
        repo.withApplied = {
          row: {
            ...makeRow(committedState()),
            version: "2026-06-01",
            lastEventOccurredAt: 1_900,
          },
          appliedEventIds: ["e1"],
        };
        const store = new CodingAgentSessionStore(repo);

        expect(await store.get("session-1", context())).toBeNull();
      });
    });
  });
});
