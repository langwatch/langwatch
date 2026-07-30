import { describe, expect, it } from "vitest";
import { PLATFORM_DEFAULT_RETENTION_DAYS } from "~/server/data-retention/retentionPolicy.schema";
import { createTenantId } from "../../../domain/tenantId";
import type { FoldCacheClient } from "../../foldCache/foldCacheClient";
import type { ProjectionStoreContext } from "../../projectionStoreContext";
import { defineFoldStore, type FoldRowRepository } from "../defineFoldStore";
import { foldCodec, type VersionedRow } from "../foldCodec";

/**
 * Everything a fold store used to assemble by hand — retention stamping, the
 * refused-versus-absent answer, arming the rebuild the gate needs, the
 * batch/single write duality, the applied-event watermark, the cache tier — is
 * a consequence of declaring the round-trip, supplied identically for every
 * fold (ADR-066).
 */

interface State {
  id: string;
  count: number;
}

interface Row extends VersionedRow {
  tenantId: string;
  id: string;
  count: number;
}

class FakeRepo implements FoldRowRepository<Row> {
  upserts: Array<{
    row: Row;
    retentionDays?: number;
    appliedEventIds?: readonly string[];
  }> = [];
  batches: Array<{
    row: Row;
    retentionDays?: number;
    appliedEventIds?: readonly string[];
  }> = [];
  found: { row: Row; appliedEventIds: string[] } | null = null;
  lastQuery: unknown;

  async upsert(
    row: Row,
    retentionDays?: number,
    appliedEventIds?: readonly string[],
  ): Promise<void> {
    this.upserts.push({ row, retentionDays, appliedEventIds });
  }

  async upsertBatch(
    entries: Array<{
      row: Row;
      retentionDays?: number;
      appliedEventIds?: readonly string[];
    }>,
  ): Promise<void> {
    this.batches.push(...entries);
  }
}

/** A repository that exposes no batch path, exercising the per-row fallback. */
class SingleWriteRepo implements FoldRowRepository<Row> {
  upserts: Row[] = [];
  async upsert(row: Row): Promise<void> {
    this.upserts.push(row);
  }
}

const definition = defineFoldStore<State, Row, FakeRepo>({
  name: "fake_fold",
  retention: "traces",
  signal: (state) => state.count > 0,
  read: async (repository, query) => {
    repository.lastQuery = query;
    return repository.found;
  },
  codec: foldCodec<State, Row>({
    generations: [{ stamp: "shape-1" }, { stamp: "shape-2" }],
    readBackSince: 2,
    reads: ["Count"],
    project: (state, { tenantId, aggregateId, version }) => ({
      version,
      tenantId,
      id: state.id || aggregateId,
      count: state.count,
    }),
    decode: (row) => ({ id: row.id, count: row.count }),
  }),
});

const singleWriteDefinition = defineFoldStore<State, Row, SingleWriteRepo>({
  name: "fake_fold_single",
  retention: "traces",
  read: async () => null,
  codec: foldCodec<State, Row>({
    generations: [{ stamp: "shape-1" }],
    readBackSince: 1,
    reads: ["Count"],
    project: (state, { tenantId, aggregateId, version }) => ({
      version,
      tenantId,
      id: state.id || aggregateId,
      count: state.count,
    }),
    decode: (row) => ({ id: row.id, count: row.count }),
  }),
});

const context = (
  over: Partial<ProjectionStoreContext> = {},
): ProjectionStoreContext => ({
  aggregateId: "agg-1",
  tenantId: createTenantId("tenant-1"),
  ...over,
});

const row = (over: Partial<Row> = {}): Row => ({
  version: "shape-2",
  tenantId: "tenant-1",
  id: "agg-1",
  count: 4,
  ...over,
});

describe("defineFoldStore", () => {
  describe("given a customer with their own retention for the kind of data held", () => {
    /** @scenario the platform stamps how long a record is kept from the kind of data it holds */
    it("stamps that retention without the fold asking for it", async () => {
      const repo = new FakeRepo();
      const store = new definition.Store(repo);

      await store.store(
        { id: "agg-1", count: 1 },
        context({
          retentionPolicy: { traces: 7, scenarios: 90, experiments: 90 },
        }),
      );

      expect(repo.upserts[0]!.retentionDays).toBe(7);
    });
  });

  describe("given no retention could be resolved for the write", () => {
    /** @scenario a fold with no retention answer still keeps records for a bounded time */
    it("stamps the platform default rather than leaving the row unbounded", async () => {
      const repo = new FakeRepo();
      const store = new definition.Store(repo);

      await store.store({ id: "agg-1", count: 1 }, context());

      expect(repo.upserts[0]!.retentionDays).toBe(
        PLATFORM_DEFAULT_RETENTION_DAYS,
      );
      expect(repo.upserts[0]!.retentionDays).toBeGreaterThan(0);
    });
  });

  describe("given a state that carries no signal yet", () => {
    /** @scenario a state with nothing worth keeping is not committed */
    it("writes nothing, and writes normally once signal arrives", async () => {
      const repo = new FakeRepo();
      const store = new definition.Store(repo);

      await store.store({ id: "agg-1", count: 0 }, context());
      expect(repo.upserts).toHaveLength(0);

      await store.store({ id: "agg-1", count: 2 }, context());
      expect(repo.upserts).toHaveLength(1);
    });
  });

  describe("given several aggregates committed together", () => {
    /** @scenario committing many aggregates at once matches committing them one at a time */
    it("writes each as it would have been written on its own", async () => {
      const repo = new FakeRepo();
      const store = new definition.Store(repo);

      await store.storeBatch([
        {
          state: { id: "agg-1", count: 1 },
          context: context({
            appliedEventIds: ["e1"],
            retentionPolicy: { traces: 7, scenarios: 90, experiments: 90 },
          }),
        },
        { state: { id: "agg-2", count: 0 }, context: context() },
        {
          state: { id: "agg-3", count: 5 },
          context: context({ appliedEventIds: ["e2", "e3"] }),
        },
      ]);

      // The signal-less entry is dropped exactly as it would be on its own.
      expect(repo.batches.map((entry) => entry.row.id)).toEqual([
        "agg-1",
        "agg-3",
      ]);
      expect(repo.batches.map((entry) => entry.appliedEventIds)).toEqual([
        ["e1"],
        ["e2", "e3"],
      ]);
      expect(repo.batches.map((entry) => entry.retentionDays)).toEqual([
        7,
        PLATFORM_DEFAULT_RETENTION_DAYS,
      ]);
    });

    describe("when the repository has no batch path", () => {
      it("falls back to writing each row on its own", async () => {
        const repo = new SingleWriteRepo();
        const store = new singleWriteDefinition.Store(repo);

        await store.storeBatch([
          { state: { id: "a", count: 1 }, context: context() },
          { state: { id: "b", count: 1 }, context: context() },
        ]);

        expect(repo.upserts.map((entry) => entry.id)).toEqual(["a", "b"]);
      });
    });
  });

  describe("given an aggregate whose record is in the current shape", () => {
    /** @scenario a record written under the current shape is recovered as written */
    it("recovers the state and the folding bookkeeping with it", async () => {
      const repo = new FakeRepo();
      repo.found = { row: row(), appliedEventIds: ["e1", "e2"] };
      const store = new definition.Store(repo);

      const result = await store.getWithApplied("agg-1", context());

      expect(result.state).toEqual({ id: "agg-1", count: 4 });
      expect(result.appliedEventIds).toEqual(["e1", "e2"]);
      expect(result.miss).toBeUndefined();
    });
  });

  describe("given an aggregate whose record is in a shape below the floor", () => {
    /** @scenario a record written under a shape this build cannot read is rebuilt */
    it("answers as no state at all, dropping the bookkeeping with it", async () => {
      const repo = new FakeRepo();
      repo.found = {
        row: row({ version: "shape-1" }),
        appliedEventIds: ["e1"],
      };
      const store = new definition.Store(repo);

      const result = await store.getWithApplied("agg-1", context());

      expect(result.state).toBeNull();
      // Keeping the watermark would make the executor skip the very events the
      // rebuild needs to replay.
      expect(result.appliedEventIds).toEqual([]);
      // Found and refused: the executor must not answer it with an unwindowed
      // re-read that can only find the same row again.
      expect(result.miss).toBe("undecodable");
    });

    it("misses through get() too, so both read paths agree", async () => {
      const repo = new FakeRepo();
      repo.found = { row: row({ version: "shape-1" }), appliedEventIds: [] };
      const store = new definition.Store(repo);

      expect(await store.get("agg-1", context())).toBeNull();
    });
  });

  describe("given an aggregate that has never been folded", () => {
    /** @scenario an aggregate with no record at all starts from an empty state */
    it("answers absent rather than unreadable", async () => {
      const repo = new FakeRepo();
      repo.found = null;
      const store = new definition.Store(repo);

      const result = await store.getWithApplied("agg-1", context());

      expect(result.state).toBeNull();
      expect(result.miss).toBe("absent");
    });
  });

  describe("given any store that decides which shapes it can read", () => {
    /** @scenario a fold that can refuse a record can always rebuild one */
    it("arms the rebuild in the same declaration as the gate", () => {
      const store = new definition.Store(new FakeRepo());
      expect(store.refoldsOnMiss).toBe(true);
      // And it survives the cache tier, which is what the executor actually
      // holds.
      expect(
        definition.cached({ repository: new FakeRepo(), cache: fakeCache() })
          .refoldsOnMiss,
      ).toBe(true);
    });
  });

  describe("given the read window the executor computed", () => {
    it("passes it to the table read verbatim", async () => {
      const repo = new FakeRepo();
      const store = new definition.Store(repo);

      await store.get(
        "agg-1",
        context({ readWindow: { fromMs: 4_000, toMs: 5_000 } }),
      );

      expect(repo.lastQuery).toEqual({
        tenantId: "tenant-1",
        aggregateId: "agg-1",
        window: { fromMs: 4_000, toMs: 5_000 },
      });
    });
  });

  describe("given a state whose key was not set by any event yet", () => {
    it("takes the key from the aggregate being folded", async () => {
      const repo = new FakeRepo();
      const store = new definition.Store(repo);

      await store.store({ id: "", count: 1 }, context());

      expect(repo.upserts[0]!.row.id).toBe("agg-1");
    });
  });

  describe("given state committed moments ago", () => {
    /** @scenario recent state is served ahead of the store without any fold arranging it */
    it("serves it from the recent-state tier, keyed by the shape it is in", async () => {
      const cache = fakeCache();
      const repository = new FakeRepo();
      const store = definition.cached({ repository, cache });

      await store.store({ id: "agg-1", count: 9 }, context());
      const served = await store.get("agg-1", context());

      // The durable read was never consulted for the second read.
      expect(repository.lastQuery).toBeUndefined();
      expect(served).toEqual({ id: "agg-1", count: 9 });
      // The shape is part of the key, so state written under another shape can
      // never be served from this tier.
      expect([...cache.entries.keys()]).toEqual([
        "fold:fake_fold:shape-2:tenant-1:agg-1",
      ]);
    });
  });
});

function fakeCache(): FoldCacheClient & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    async read(key) {
      return entries.get(key) ?? null;
    },
    async write(key, value) {
      entries.set(key, value);
    },
  };
}
