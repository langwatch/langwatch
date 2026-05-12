import { describe, it, expect } from "vitest";
import {
  aggregateKey,
  markPendingBatch,
  markCutoffBatch,
  unmarkBatch,
  getCompletedSet,
  getCutoffMarkers,
  cleanupAll,
  hasPreviousRun,
} from "../replayMarkers";

/**
 * Create a minimal Redis mock with pipeline support.
 *
 * Simulates ioredis pipeline semantics: pipeline methods are queued
 * and executed atomically on `exec()`. Each pipeline method returns
 * the pipeline itself (for optional chaining).
 */
function createRedisMock() {
  const store = new Map<string, Map<string, string>>(); // HSET storage
  const sets = new Map<string, Set<string>>(); // SADD storage
  const ttls = new Map<string, number>();

  const redis = {
    pipeline: () => {
      const pipelineOps: Array<() => void> = [];

      const pipe = {
        hset: (key: string, field: string, value: string) => {
          pipelineOps.push(() => {
            if (!store.has(key)) store.set(key, new Map());
            store.get(key)!.set(field, value);
          });
          return pipe;
        },
        hdel: (key: string, field: string) => {
          pipelineOps.push(() => {
            store.get(key)?.delete(field);
          });
          return pipe;
        },
        sadd: (key: string, member: string) => {
          pipelineOps.push(() => {
            if (!sets.has(key)) sets.set(key, new Set());
            sets.get(key)!.add(member);
          });
          return pipe;
        },
        expire: (key: string, seconds: number) => {
          pipelineOps.push(() => {
            ttls.set(key, seconds);
          });
          return pipe;
        },
        exec: async () => {
          for (const op of pipelineOps) op();
          pipelineOps.length = 0;
          return [];
        },
      };

      return pipe;
    },
    hgetall: async (key: string) => {
      const map = store.get(key);
      if (!map) return {};
      return Object.fromEntries(map);
    },
    hdel: async (key: string, field: string) => {
      store.get(key)?.delete(field);
    },
    smembers: async (key: string) => {
      return [...(sets.get(key) ?? [])];
    },
    scard: async (key: string) => {
      return sets.get(key)?.size ?? 0;
    },
    hlen: async (key: string) => {
      return store.get(key)?.size ?? 0;
    },
    del: async (key: string) => {
      store.delete(key);
      sets.delete(key);
    },
    _store: store,
    _sets: sets,
    _ttls: ttls,
  };

  return redis as any;
}

describe("replayMarkers", () => {
  describe("aggregateKey", () => {
    it("formats as tenantId:aggregateType:aggregateId", () => {
      expect(
        aggregateKey({
          tenantId: "t1",
          aggregateType: "trace",
          aggregateId: "a1",
        }),
      ).toBe("t1:trace:a1");
    });
  });

  describe("markPendingBatch", () => {
    it("sets pending markers for all aggregate keys", async () => {
      const redis = createRedisMock();
      await markPendingBatch({
        redis,
        projectionName: "traceSummary",
        aggKeys: ["t1:trace:a1", "t1:trace:a2"],
      });

      const markers = await redis.hgetall(
        "projection-replay:cutoff:traceSummary",
      );
      expect(markers["t1:trace:a1"]).toBe("pending");
      expect(markers["t1:trace:a2"]).toBe("pending");
    });

    it("sets TTL on the cutoff key", async () => {
      const redis = createRedisMock();
      await markPendingBatch({
        redis,
        projectionName: "traceSummary",
        aggKeys: ["t1:trace:a1"],
      });

      expect(redis._ttls.get("projection-replay:cutoff:traceSummary")).toBe(
        7 * 24 * 3600,
      );
    });

    describe("when aggKeys is empty", () => {
      it("skips without errors", async () => {
        const redis = createRedisMock();
        await markPendingBatch({ redis, projectionName: "x", aggKeys: [] });
        // No markers set
        expect(await redis.hlen("projection-replay:cutoff:x")).toBe(0);
      });
    });
  });

  describe("markCutoffBatch", () => {
    it("sets cutoff markers in timestamp:eventId format", async () => {
      const redis = createRedisMock();
      const cutoffs = new Map([
        ["t1:trace:a1", { timestamp: 1700000000000, eventId: "evt-abc" }],
        ["t1:trace:a2", { timestamp: 1700000001000, eventId: "evt-def" }],
      ]);

      await markCutoffBatch({
        redis,
        projectionName: "traceSummary",
        cutoffs,
      });

      const markers = await redis.hgetall(
        "projection-replay:cutoff:traceSummary",
      );
      expect(markers["t1:trace:a1"]).toBe("1700000000000:evt-abc");
      expect(markers["t1:trace:a2"]).toBe("1700000001000:evt-def");
    });

    describe("when cutoffs map is empty", () => {
      it("skips without errors", async () => {
        const redis = createRedisMock();
        await markCutoffBatch({
          redis,
          projectionName: "x",
          cutoffs: new Map(),
        });
        expect(await redis.hlen("projection-replay:cutoff:x")).toBe(0);
      });
    });
  });

  describe("unmarkBatch", () => {
    it("removes cutoff markers and adds to completed set", async () => {
      const redis = createRedisMock();

      // Set up markers first
      await markPendingBatch({
        redis,
        projectionName: "traceSummary",
        aggKeys: ["t1:trace:a1", "t1:trace:a2"],
      });

      // Unmark
      await unmarkBatch({
        redis,
        projectionName: "traceSummary",
        aggKeys: ["t1:trace:a1", "t1:trace:a2"],
      });

      // Cutoff markers removed
      const markers = await redis.hgetall(
        "projection-replay:cutoff:traceSummary",
      );
      expect(Object.keys(markers)).toHaveLength(0);

      // Completed set populated
      const completed = await redis.smembers(
        "projection-replay:completed:traceSummary",
      );
      expect(completed).toContain("t1:trace:a1");
      expect(completed).toContain("t1:trace:a2");
    });

    describe("when aggKeys is empty", () => {
      it("skips without errors", async () => {
        const redis = createRedisMock();
        await unmarkBatch({
          redis,
          projectionName: "x",
          aggKeys: [],
        });
        expect(await redis.hlen("projection-replay:cutoff:x")).toBe(0);
      });
    });
  });

  describe("getCompletedSet", () => {
    it("returns a Set of completed aggregate keys", async () => {
      const redis = createRedisMock();
      await markPendingBatch({
        redis,
        projectionName: "p",
        aggKeys: ["k1", "k2"],
      });
      await unmarkBatch({
        redis,
        projectionName: "p",
        aggKeys: ["k1", "k2"],
      });

      const completed = await getCompletedSet({
        redis,
        projectionName: "p",
      });

      expect(completed).toBeInstanceOf(Set);
      expect(completed.has("k1")).toBe(true);
      expect(completed.has("k2")).toBe(true);
      expect(completed.size).toBe(2);
    });

    describe("when no keys are completed", () => {
      it("returns an empty Set", async () => {
        const redis = createRedisMock();
        const completed = await getCompletedSet({
          redis,
          projectionName: "p",
        });
        expect(completed.size).toBe(0);
      });
    });
  });

  describe("getCutoffMarkers", () => {
    it("returns a Map of all pending/cutoff markers", async () => {
      const redis = createRedisMock();
      await markPendingBatch({
        redis,
        projectionName: "p",
        aggKeys: ["k1"],
      });
      const cutoffs = new Map([
        ["k2", { timestamp: 1700000000000, eventId: "evt-xyz" }],
      ]);
      await markCutoffBatch({ redis, projectionName: "p", cutoffs });

      const markers = await getCutoffMarkers({ redis, projectionName: "p" });

      expect(markers).toBeInstanceOf(Map);
      expect(markers.get("k1")).toBe("pending");
      expect(markers.get("k2")).toBe("1700000000000:evt-xyz");
    });
  });

  describe("cleanupAll", () => {
    it("removes both cutoff and completed keys", async () => {
      const redis = createRedisMock();
      await markPendingBatch({ redis, projectionName: "p", aggKeys: ["k1"] });
      await unmarkBatch({ redis, projectionName: "p", aggKeys: ["k1"] });

      await cleanupAll({ redis, projectionName: "p" });

      expect(await redis.hlen("projection-replay:cutoff:p")).toBe(0);
      expect(await redis.scard("projection-replay:completed:p")).toBe(0);
    });
  });

  describe("hasPreviousRun", () => {
    describe("when no previous run exists", () => {
      it("returns zero counts", async () => {
        const redis = createRedisMock();
        const result = await hasPreviousRun({
          redis,
          projectionName: "p",
        });
        expect(result).toEqual({ completedCount: 0, markerCount: 0 });
      });
    });

    describe("when a previous run exists", () => {
      it("returns non-zero counts", async () => {
        const redis = createRedisMock();
        await markPendingBatch({
          redis,
          projectionName: "p",
          aggKeys: ["k1", "k2"],
        });
        await unmarkBatch({
          redis,
          projectionName: "p",
          aggKeys: ["k1"],
        });

        const result = await hasPreviousRun({
          redis,
          projectionName: "p",
        });
        expect(result).toEqual({ completedCount: 1, markerCount: 1 });
      });
    });
  });
});
