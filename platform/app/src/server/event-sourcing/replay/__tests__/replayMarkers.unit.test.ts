import { describe, it, expect } from "vitest";
import {
  aggregateKey,
  markPendingBatch,
  markCutoffBatch,
  markCompletedBatch,
  unmarkBatch,
  removeInFlightMarkers,
  clearFailedBatchMarkers,
  getCompletedSet,
  getCutoffMarkers,
  cleanupAll,
  hasPreviousRun,
} from "../replayMarkers";
import { DONE_MARKER_TTL_SECONDS, doneMarkerKey } from "../replayConstants";

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
  const strings = new Map<string, string>(); // SET storage
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
        hdel: (key: string, ...fields: string[]) => {
          pipelineOps.push(() => {
            for (const field of fields) store.get(key)?.delete(field);
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
        set: (key: string, value: string, mode?: string, seconds?: number) => {
          pipelineOps.push(() => {
            strings.set(key, value);
            if (mode === "EX" && typeof seconds === "number") ttls.set(key, seconds);
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
    get: async (key: string) => {
      return strings.get(key) ?? null;
    },
    del: async (key: string) => {
      store.delete(key);
      sets.delete(key);
      strings.delete(key);
    },
    _store: store,
    _sets: sets,
    _strings: strings,
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

  describe("markCompletedBatch", () => {
    it("drops the active cutoff marker, writes a short-TTL done marker, and records completion", async () => {
      const redis = createRedisMock();
      const cutoffs = new Map([
        ["t1:trace:a1", { timestamp: 1700000001000, eventId: "evt-010" }],
        ["t1:trace:a2", { timestamp: 1700000002000, eventId: "evt-020" }],
      ]);

      // Active cutoff markers exist before completion.
      await markCutoffBatch({ redis, projectionName: "traceSummary", cutoffs });

      await markCompletedBatch({ redis, projectionName: "traceSummary", cutoffs });

      // Cutoff hash is drained (stays bounded to in-flight aggregates)...
      const markers = await redis.hgetall("projection-replay:cutoff:traceSummary");
      expect(Object.keys(markers)).toHaveLength(0);

      // ...the boundary lives in a separate short-TTL done key per aggregate...
      expect(
        await redis.get(doneMarkerKey("traceSummary", "t1:trace:a1")),
      ).toBe("1700000001000:evt-010");
      expect(
        await redis.get(doneMarkerKey("traceSummary", "t1:trace:a2")),
      ).toBe("1700000002000:evt-020");
      expect(redis._ttls.get(doneMarkerKey("traceSummary", "t1:trace:a1"))).toBe(
        DONE_MARKER_TTL_SECONDS,
      );

      // ...and completion is recorded for resume accounting.
      const completed = await redis.smembers("projection-replay:completed:traceSummary");
      expect(completed).toContain("t1:trace:a1");
      expect(completed).toContain("t1:trace:a2");
    });

    describe("when cutoffs map is empty", () => {
      it("skips without errors", async () => {
        const redis = createRedisMock();
        await markCompletedBatch({ redis, projectionName: "x", cutoffs: new Map() });
        expect(await redis.hlen("projection-replay:cutoff:x")).toBe(0);
      });
    });
  });

  describe("removeInFlightMarkers", () => {
    it("removes cutoff fields across all projections, leaving completed set and done markers untouched", async () => {
      const redis = createRedisMock();

      // In-flight markers across two projections.
      await markPendingBatch({
        redis,
        projectionName: "traceSummary",
        aggKeys: ["t1:trace:a1", "t1:trace:a2"],
      });
      await markPendingBatch({
        redis,
        projectionName: "spanIndex",
        aggKeys: ["t1:trace:a1", "t1:trace:a2"],
      });

      // A previously completed batch: done marker + completed-set entry.
      const doneCutoffs = new Map([
        ["t1:trace:done", { timestamp: 1700000000000, eventId: "evt-done" }],
      ]);
      await markCompletedBatch({
        redis,
        projectionName: "traceSummary",
        cutoffs: doneCutoffs,
      });

      await removeInFlightMarkers({
        redis,
        projectionNames: ["traceSummary", "spanIndex"],
        aggKeys: ["t1:trace:a1", "t1:trace:a2"],
      });

      // Cutoff fields removed in both projections.
      expect(await redis.hlen("projection-replay:cutoff:traceSummary")).toBe(0);
      expect(await redis.hlen("projection-replay:cutoff:spanIndex")).toBe(0);

      // Done marker and completed set from the completed batch survive.
      expect(
        await redis.get(doneMarkerKey("traceSummary", "t1:trace:done")),
      ).toBe("1700000000000:evt-done");
      const completed = await redis.smembers(
        "projection-replay:completed:traceSummary",
      );
      expect(completed).toContain("t1:trace:done");

      // Removed in-flight aggregates are NOT recorded as completed.
      expect(completed).not.toContain("t1:trace:a1");
      expect(completed).not.toContain("t1:trace:a2");
    });

    describe("when aggKeys is empty", () => {
      it("skips without executing a pipeline", async () => {
        const redis = createRedisMock();
        const originalPipeline = redis.pipeline;
        let pipelineCalls = 0;
        redis.pipeline = () => {
          pipelineCalls++;
          return originalPipeline();
        };

        await removeInFlightMarkers({
          redis,
          projectionNames: ["traceSummary"],
          aggKeys: [],
        });

        expect(pipelineCalls).toBe(0);
      });
    });

    describe("when projectionNames is empty", () => {
      it("skips without executing a pipeline", async () => {
        const redis = createRedisMock();
        const originalPipeline = redis.pipeline;
        let pipelineCalls = 0;
        redis.pipeline = () => {
          pipelineCalls++;
          return originalPipeline();
        };

        await removeInFlightMarkers({
          redis,
          projectionNames: [],
          aggKeys: ["t1:trace:a1"],
        });

        expect(pipelineCalls).toBe(0);
      });
    });
  });

  describe("clearFailedBatchMarkers", () => {
    describe("when marker cleanup fails", () => {
      it("resolves without throwing and logs the cleanup failure", async () => {
        const failingRedis = {
          pipeline: () => {
            const pipe = {
              hdel: (_key: string, ..._fields: string[]) => pipe,
              exec: async () => {
                throw new Error("redis connection lost");
              },
            };
            return pipe;
          },
        } as any;
        const entries: Record<string, unknown>[] = [];
        const log = {
          write: (entry: Record<string, unknown>) => entries.push(entry),
        };

        await expect(
          clearFailedBatchMarkers({
            redis: failingRedis,
            projectionNames: ["traceSummary"],
            aggKeys: ["t1:trace:a1"],
            log,
          }),
        ).resolves.toBeUndefined();

        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ step: "error" });
        expect(entries[0]!.error).toContain(
          "failed to clear replay markers for failed batch",
        );
        expect(entries[0]!.error).toContain("redis connection lost");
      });
    });

    describe("when marker cleanup succeeds", () => {
      it("removes the markers and writes no log entry", async () => {
        const redis = createRedisMock();
        await markPendingBatch({
          redis,
          projectionName: "traceSummary",
          aggKeys: ["t1:trace:a1"],
        });
        const entries: Record<string, unknown>[] = [];
        const log = {
          write: (entry: Record<string, unknown>) => entries.push(entry),
        };

        await clearFailedBatchMarkers({
          redis,
          projectionNames: ["traceSummary"],
          aggKeys: ["t1:trace:a1"],
          log,
        });

        expect(await redis.hlen("projection-replay:cutoff:traceSummary")).toBe(0);
        expect(entries).toHaveLength(0);
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
