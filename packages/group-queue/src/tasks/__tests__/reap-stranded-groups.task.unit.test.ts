import { describe, expect, it, vi } from "vitest";
import type { GroupQueueRedis } from "../../dependencies-adapter";
import { reapStrandedGroups } from "../reap-stranded-groups.task";

const PREFIX = "{event-sourcing/jobs}:gq:";
const NOW = 1_800_000_000_000;

/**
 * A Redis double holding only what the reaper reads: the job zsets, the ready
 * zset, the blocked set, the active keys and the pending counter.
 */
function fakeRedis(state: {
  jobs: Record<string, number[]>;
  ready?: string[];
  blocked?: string[];
  active?: string[];
}) {
  const deleted: string[] = [];
  const written: Record<string, string> = {};
  const jobs = { ...state.jobs };
  const redis = {
    scan: vi.fn(async () => [
      "0",
      Object.keys(jobs).map((groupId) => `${PREFIX}group:${groupId}:jobs`),
    ]),
    zscore: vi.fn(async (_key: string, groupId: string) =>
      state.ready?.includes(groupId) ? "1" : null,
    ),
    exists: vi.fn(async (key: string) =>
      state.active?.some((groupId) => key === `${PREFIX}group:${groupId}:active`) ? 1 : 0,
    ),
    sismember: vi.fn(async (_key: string, groupId: string) =>
      state.blocked?.includes(groupId) ? 1 : 0,
    ),
    zrange: vi.fn(async (key: string) => {
      const groupId = key.slice(`${PREFIX}group:`.length, -":jobs".length);
      const scores = jobs[groupId] ?? [];
      const newest = scores[scores.length - 1];
      return newest === undefined ? [] : ["job", String(newest)];
    }),
    zcard: vi.fn(async (key: string) => {
      const groupId = key.slice(`${PREFIX}group:`.length, -":jobs".length);
      return jobs[groupId]?.length ?? 0;
    }),
    del: vi.fn(async (...keys: string[]) => {
      deleted.push(...keys);
      for (const key of keys) {
        if (!key.endsWith(":jobs")) continue;
        delete jobs[key.slice(`${PREFIX}group:`.length, -":jobs".length)];
      }
      return keys.length;
    }),
    set: vi.fn(async (key: string, value: string) => {
      written[key] = value;
      return "OK";
    }),
  };
  return { redis: redis as unknown as GroupQueueRedis, deleted, written };
}

const hoursAgo = (hours: number) => NOW - hours * 60 * 60 * 1000;

describe("reapStrandedGroups", () => {
  describe("given groups the dispatcher can and cannot reach", () => {
    /** @scenario "The stranded-group reaper reports before it deletes" */
    it("reports only the unreachable ones and deletes nothing", async () => {
      const { redis, deleted } = fakeRedis({
        jobs: {
          stranded: [hoursAgo(30), hoursAgo(24)],
          ready: [hoursAgo(24)],
          active: [hoursAgo(24)],
          blocked: [hoursAgo(24)],
        },
        ready: ["ready"],
        active: ["active"],
        blocked: ["blocked"],
      });

      const report = await reapStrandedGroups({
        redis,
        keyPrefix: PREFIX,
        now: () => NOW,
      });

      expect(report.mode).toBe("discover");
      expect(report.groups.map((group) => group.groupId)).toEqual(["stranded"]);
      expect(report.strandedJobs).toBe(2);
      expect(deleted).toEqual([]);
    });
  });

  describe("when a group left the state sets only minutes ago", () => {
    /** @scenario "The stranded-group reaper leaves a briefly stranded live group alone" */
    it("is not listed and none of its keys are deleted", async () => {
      const { redis, deleted } = fakeRedis({ jobs: { fresh: [NOW - 60_000] } });

      const report = await reapStrandedGroups({
        redis,
        keyPrefix: PREFIX,
        minAgeHours: 6,
        apply: true,
        now: () => NOW,
      });

      expect(report.groups).toEqual([]);
      expect(deleted).toEqual([]);
    });
  });

  describe("when the operator applies the deletions", () => {
    /** @scenario "The stranded-group reaper recounts pending jobs from what survives" */
    it("recomputes the pending counter from the surviving groups", async () => {
      const { redis, deleted, written } = fakeRedis({
        jobs: { stranded: [hoursAgo(30)], live: [hoursAgo(24)] },
        ready: ["live"],
      });

      const report = await reapStrandedGroups({
        redis,
        keyPrefix: PREFIX,
        apply: true,
        now: () => NOW,
      });

      expect(report.deletedGroups).toBe(1);
      expect(deleted).toEqual([`${PREFIX}group:stranded:jobs`, `${PREFIX}group:stranded:data`]);
      expect(written[`${PREFIX}stats:total-pending`]).toBe("1");
      expect(report.totalPendingNow).toBe(1);
    });
  });
});
