/**
 * The span dedup claim over Redis, a batch at a time: one pipeline of
 * `SET key processing EX 60 NX` to claim, one of `SET key processed EX 3600` to confirm.
 * @vitest-environment node
 */
import { memoryRedisDouble, memoryRedisStore } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { RedisTraceSpanDedupRepository } from "../redis.trace-span-dedup.repository.ts";

const silent = { warn: () => undefined };
const ref = (spanId: string) => ({ tenantId: "project-1", traceId: "trace-1", spanId });

function dedupOver({
  script = {},
  isCluster = false,
}: {
  script?: NonNullable<Parameters<typeof memoryRedisDouble>[0]>["script"];
  isCluster?: boolean;
} = {}) {
  const store = memoryRedisStore();
  const connection = memoryRedisDouble({ store, script: { isCluster, ...script } });
  return { store, dedup: RedisTraceSpanDedupRepository.create({ connection, logger: silent }) };
}

describe("RedisTraceSpanDedupRepository", () => {
  describe("given spans nobody has claimed", () => {
    it("acquires every one under the frozen key format", async () => {
      const { store, dedup } = dedupOver();

      await expect(dedup.claimProcessing([ref("a"), ref("b")])).resolves.toEqual([
        { outcome: "acquired" },
        { outcome: "acquired" },
      ]);
      expect(store.strings.get("span_dedup:project-1:trace-1:a")).toBe("processing");
    });
  });

  describe("given a span claimed before, and a span repeated in the same batch", () => {
    it("answers held for each, in the order asked", async () => {
      const { dedup } = dedupOver();
      await dedup.claimProcessing([ref("a")]);

      await expect(dedup.claimProcessing([ref("b"), ref("a"), ref("b")])).resolves.toEqual([
        { outcome: "acquired" },
        { outcome: "held" },
        { outcome: "held" },
      ]);
    });
  });

  describe("given spans that were ingested", () => {
    it("marks each processed for the SDK retry window", async () => {
      const { store, dedup } = dedupOver();
      await dedup.claimProcessing([ref("a"), ref("b")]);

      await dedup.confirmProcessed([ref("a"), ref("b")]);

      expect(store.strings.get("span_dedup:project-1:trace-1:a")).toBe("processed");
      expect(store.strings.get("span_dedup:project-1:trace-1:b")).toBe("processed");
    });
  });

  describe("given an empty batch", () => {
    it("sends nothing", async () => {
      const sent: unknown[][] = [];
      const { dedup } = dedupOver({
        script: {
          set: async (...args: unknown[]) => {
            sent.push(args);
            return "OK";
          },
        },
      });

      await expect(dedup.claimProcessing([])).resolves.toEqual([]);
      await dedup.confirmProcessed([]);

      expect(sent).toEqual([]);
    });
  });

  describe("given the store cannot answer a claim", () => {
    it("answers unknown, so the span is ingested anyway", async () => {
      const { dedup } = dedupOver({
        script: {
          set: async () => {
            throw new Error("redis down");
          },
        },
      });

      await expect(dedup.claimProcessing([ref("a")])).resolves.toEqual([{ outcome: "unknown" }]);
      await expect(dedup.confirmProcessed([ref("a")])).resolves.toBeUndefined();
    });
  });

  describe("given a cluster, which will not pipeline keys from different slots", () => {
    it("claims and confirms each span on its own, with the same answers", async () => {
      const { store, dedup } = dedupOver({
        isCluster: true,
        script: {
          pipeline: () => {
            throw new Error("keys in different slots");
          },
        },
      });
      await dedup.claimProcessing([ref("a")]);

      await expect(dedup.claimProcessing([ref("a"), ref("b")])).resolves.toEqual([
        { outcome: "held" },
        { outcome: "acquired" },
      ]);
      await dedup.confirmProcessed([ref("b")]);

      expect(store.strings.get("span_dedup:project-1:trace-1:b")).toBe("processed");
    });
  });
});
