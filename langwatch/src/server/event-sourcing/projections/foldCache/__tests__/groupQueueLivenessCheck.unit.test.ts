import { describe, expect, it, vi } from "vitest";
import { foldGroupKey } from "../../../services/queues/groupKey";
import { GroupQueueLivenessCheck } from "../groupQueueLivenessCheck";

/**
 * Each aggregate contributes three replies in order: staged job count, active
 * marker, blocked membership.
 */
function createRedis(replies: Array<[Error | null, unknown]>) {
  const probed: string[] = [];
  const chain = {
    hlen: vi.fn((key: string) => {
      probed.push(key);
      return chain;
    }),
    exists: vi.fn((key: string) => {
      probed.push(key);
      return chain;
    }),
    sismember: vi.fn((key: string, member: string) => {
      probed.push(`${key}#${member}`);
      return chain;
    }),
    exec: vi.fn(async () => replies),
  };
  return { redis: { pipeline: vi.fn(() => chain) }, probed };
}

function createCheck(replies: Array<[Error | null, unknown]>) {
  const { redis, probed } = createRedis(replies);
  const check = new GroupQueueLivenessCheck({
    redis: redis as never,
    queueName: "global",
    projectionName: "traceSummary",
    aggregateType: "trace",
  });
  return { check, probed };
}

const QUIET: Array<[Error | null, unknown]> = [
  [null, 0],
  [null, 0],
  [null, 0],
];

describe("GroupQueueLivenessCheck", () => {
  describe("the key it inspects", () => {
    it("matches the group key the queue builds for that fold's jobs", async () => {
      const { check, probed } = createCheck(QUIET);

      await check.withWorkInFlight({
        tenantId: "tenant-1",
        aggregateIds: ["trace-1"],
      });

      // A key that does not exist reads as "quiet", which would release a cache
      // entry a retry still depends on — so this derivation must not drift from
      // the queue's own.
      const expected = foldGroupKey({
        tenantId: "tenant-1",
        projectionName: "traceSummary",
        aggregateType: "trace",
        aggregateId: "trace-1",
      });
      expect(probed).toEqual([
        `global:gq:group:${expected}:data`,
        `global:gq:group:${expected}:active`,
        `global:gq:blocked#${expected}`,
      ]);
    });
  });

  describe("given an aggregate with no queue work", () => {
    it("reports it as quiet, so its cache entry may be released", async () => {
      const { check } = createCheck(QUIET);

      const result = await check.withWorkInFlight({
        tenantId: "tenant-1",
        aggregateIds: ["trace-1"],
      });

      expect(result.size).toBe(0);
    });
  });

  describe("given an aggregate with a staged job", () => {
    it("reports it as in flight", async () => {
      const { check } = createCheck([
        [null, 2],
        [null, 0],
        [null, 0],
      ]);

      const result = await check.withWorkInFlight({
        tenantId: "tenant-1",
        aggregateIds: ["trace-1"],
      });

      expect(result.has("trace-1")).toBe(true);
    });
  });

  describe("given an aggregate whose group is blocked after exhausting retries", () => {
    it("reports it as in flight, because its jobs will run again", async () => {
      const { check } = createCheck([
        [null, 0],
        [null, 0],
        [null, 1],
      ]);

      const result = await check.withWorkInFlight({
        tenantId: "tenant-1",
        aggregateIds: ["trace-1"],
      });

      expect(result.has("trace-1")).toBe(true);
    });
  });

  describe("given Redis returns an error for an aggregate", () => {
    it("reports it as in flight rather than assuming it is quiet", async () => {
      const { check } = createCheck([
        [new Error("connection reset"), null],
        [null, 0],
        [null, 0],
      ]);

      const result = await check.withWorkInFlight({
        tenantId: "tenant-1",
        aggregateIds: ["trace-1"],
      });

      expect(result.has("trace-1")).toBe(true);
    });
  });

  describe("given several aggregates in one pass", () => {
    it("attributes each reply triple to the right aggregate", async () => {
      const { check } = createCheck([
        ...QUIET,
        [null, 1],
        [null, 0],
        [null, 0],
        ...QUIET,
      ]);

      const result = await check.withWorkInFlight({
        tenantId: "tenant-1",
        aggregateIds: ["trace-1", "trace-2", "trace-3"],
      });

      expect([...result]).toEqual(["trace-2"]);
    });
  });
});
