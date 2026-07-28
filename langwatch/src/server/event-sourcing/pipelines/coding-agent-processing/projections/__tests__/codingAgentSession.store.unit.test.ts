import { describe, expect, it } from "vitest";
import type { CodingAgentSessionRepository } from "~/server/app-layer/coding-agent/repositories/coding-agent-session.repository";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";
import {
  type CodingAgentSessionRow,
  type CodingAgentSessionState,
  CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
  projectCodingAgentSessionToRow,
} from "../codingAgentSession.foldProjection";
import { CodingAgentSessionStore } from "../codingAgentSession.store";
import { createInitCodingAgentSession } from "../../services/coding-agent-session.derivation";

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
  withApplied: { row: CodingAgentSessionRow; appliedEventIds: string[] } | null =
    null;
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
  }): Promise<{ row: CodingAgentSessionRow; appliedEventIds: string[] } | null> {
    this.lastFindParams = params;
    return this.withApplied;
  }

  async findManyRecent(): Promise<CodingAgentSessionRow[]> {
    return [];
  }
}

const context = (over: Partial<ProjectionStoreContext> = {}): ProjectionStoreContext => ({
  aggregateId: "session-1",
  tenantId,
  ...over,
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

  describe("given the read-back store holds a committed session", () => {
    describe("when the fold reads the state with its watermark", () => {
      /** @scenario a redelivered batch after a committed write does not double-count */
      it("maps the row to state and returns the persisted watermark", async () => {
        const repo = new FakeRepo();
        const state = makeState({ modelCalls: 3 });
        repo.withApplied = { row: makeRow(state), appliedEventIds: ["e1", "e2"] };
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
 * The version gate (ADR-066). The read-back columns of migrations 00053/00054
 * are only trustworthy on a row this build wrote; a row written before them
 * decodes every one as a ClickHouse default indistinguishable from a real value.
 * The store therefore decodes a row ONLY at the current projection version and
 * reports any other stamp as a miss, which the fold's `refoldOnStoreMiss`
 * rebuilds from `event_log` once.
 */
describe("CodingAgentSessionStore read-back version gate", () => {
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

        const { state, appliedEventIds } = await store.getWithApplied(
          "session-1",
          context(),
        );

        expect(state).toBeNull();
        // The watermark goes with the state: keeping it would suppress the very
        // events the re-fold needs to see.
        expect(appliedEventIds).toEqual([]);
      });

      it("misses through get() too, so both read paths agree", async () => {
        const repo = new FakeRepo();
        repo.withApplied = { row: staleRow(), appliedEventIds: ["e1"] };
        const store = new CodingAgentSessionStore(repo);

        expect(await store.get("session-1", context())).toBeNull();
      });
    });
  });
});
