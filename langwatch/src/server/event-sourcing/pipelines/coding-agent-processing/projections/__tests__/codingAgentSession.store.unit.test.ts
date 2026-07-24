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
