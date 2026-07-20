import { describe, expect, it, vi } from "vitest";

import {
  backfillTopicClusteringSchedules,
  seedClusteringSchedules,
  type BackfillDeps,
} from "../seedClusteringSchedules";

/**
 * Unit tests for the ADR-051 legacy-project schedule seed. Only the
 * boundaries are mocked — the Prisma paging query, the already-scheduled
 * lookup, and the bootstrap command. The paging loop, the outcome counters,
 * and the skip/failure bookkeeping under test stay real.
 */

/** A fake project page source that serves `pages` in order, then empties. */
const pagerOver = (pages: string[][]) => {
  const calls: { afterId: string | null; take: number }[] = [];
  const findEligibleProjectsPage: BackfillDeps["findEligibleProjectsPage"] =
    async ({ afterId, take }) => {
      calls.push({ afterId, take });
      const index = calls.length - 1;
      return (pages[index] ?? []).map((id) => ({ id }));
    };
  return { findEligibleProjectsPage, calls };
};

const noneScheduled: BackfillDeps["findAlreadyScheduledProjectIds"] =
  async () => new Set<string>();

describe("backfillTopicClusteringSchedules", () => {
  describe("given every project bootstraps cleanly", () => {
    describe("when the walk runs", () => {
      it("counts one success per project and no failures", async () => {
        const requestClustering = vi.fn().mockResolvedValue(undefined);

        const summary = await backfillTopicClusteringSchedules({
          ...pagerOver([["p1", "p2", "p3"]]),
          findAlreadyScheduledProjectIds: noneScheduled,
          requestClustering,
          pageSize: 10,
        });

        expect(summary).toEqual({
          succeeded: 3,
          failed: 0,
          skipped: 0,
          scanned: 3,
        });
        expect(requestClustering).toHaveBeenCalledTimes(3);
      });
    });
  });

  describe("given one project's bootstrap request throws", () => {
    describe("when the walk reaches it", () => {
      it("continues bootstrapping the projects after it", async () => {
        const requestClustering = vi
          .fn()
          .mockImplementation(async ({ projectId }: { projectId: string }) => {
            if (projectId === "p2") throw new Error("boom");
          });

        const summary = await backfillTopicClusteringSchedules({
          ...pagerOver([["p1", "p2", "p3", "p4"]]),
          findAlreadyScheduledProjectIds: noneScheduled,
          requestClustering,
          pageSize: 10,
        });

        expect(
          requestClustering.mock.calls.map(([args]) => args.projectId),
        ).toEqual(["p1", "p2", "p3", "p4"]);
        expect(summary.scanned).toBe(4);
      });

      it("reports the real outcome split rather than a blanket total", async () => {
        const requestClustering = vi
          .fn()
          .mockImplementation(async ({ projectId }: { projectId: string }) => {
            if (projectId === "p2") throw new Error("boom");
          });

        const summary = await backfillTopicClusteringSchedules({
          ...pagerOver([["p1", "p2", "p3", "p4"]]),
          findAlreadyScheduledProjectIds: noneScheduled,
          requestClustering,
          pageSize: 10,
        });

        expect(summary).toEqual({
          succeeded: 3,
          failed: 1,
          skipped: 0,
          scanned: 4,
        });
      });
    });
  });

  describe("given some projects already have a scheduled wake", () => {
    describe("when the walk runs", () => {
      it("counts them as skipped without issuing a bootstrap request", async () => {
        const requestClustering = vi.fn().mockResolvedValue(undefined);

        const summary = await backfillTopicClusteringSchedules({
          ...pagerOver([["p1", "p2", "p3"]]),
          findAlreadyScheduledProjectIds: async () => new Set(["p1", "p3"]),
          requestClustering,
          pageSize: 10,
        });

        expect(summary).toEqual({
          succeeded: 1,
          failed: 0,
          skipped: 2,
          scanned: 3,
        });
        expect(
          requestClustering.mock.calls.map(([args]) => args.projectId),
        ).toEqual(["p2"]);
      });
    });
  });

  describe("given more projects than fit in one page", () => {
    describe("when the walk runs", () => {
      it("bootstraps every project across all pages", async () => {
        const requestClustering = vi.fn().mockResolvedValue(undefined);

        const summary = await backfillTopicClusteringSchedules({
          ...pagerOver([
            ["p1", "p2"],
            ["p3", "p4"],
            ["p5"],
          ]),
          findAlreadyScheduledProjectIds: noneScheduled,
          requestClustering,
          pageSize: 2,
        });

        expect(summary.succeeded).toBe(5);
        expect(
          requestClustering.mock.calls.map(([args]) => args.projectId),
        ).toEqual(["p1", "p2", "p3", "p4", "p5"]);
      });

      it("advances the keyset cursor to the last id of the previous page", async () => {
        const pager = pagerOver([
          ["p1", "p2"],
          ["p3", "p4"],
          ["p5"],
        ]);

        await backfillTopicClusteringSchedules({
          ...pager,
          findAlreadyScheduledProjectIds: noneScheduled,
          requestClustering: vi.fn().mockResolvedValue(undefined),
          pageSize: 2,
        });

        expect(pager.calls).toEqual([
          { afterId: null, take: 2 },
          { afterId: "p2", take: 2 },
          { afterId: "p4", take: 2 },
        ]);
      });

      it("stops on a short page instead of querying again", async () => {
        const pager = pagerOver([["p1", "p2"], ["p3"]]);

        await backfillTopicClusteringSchedules({
          ...pager,
          findAlreadyScheduledProjectIds: noneScheduled,
          requestClustering: vi.fn().mockResolvedValue(undefined),
          pageSize: 2,
        });

        expect(pager.calls).toHaveLength(2);
      });

      it("looks up already-scheduled projects once per page, scoped to that page", async () => {
        const findAlreadyScheduledProjectIds = vi
          .fn()
          .mockResolvedValue(new Set<string>());

        await backfillTopicClusteringSchedules({
          ...pagerOver([["p1", "p2"], ["p3"]]),
          findAlreadyScheduledProjectIds,
          requestClustering: vi.fn().mockResolvedValue(undefined),
          pageSize: 2,
        });

        expect(
          findAlreadyScheduledProjectIds.mock.calls.map(
            ([args]) => args.projectIds,
          ),
        ).toEqual([["p1", "p2"], ["p3"]]);
      });
    });
  });

  describe("given a project fails on a page that is not the last one", () => {
    describe("when the walk runs", () => {
      it("keeps paging past the failure", async () => {
        const requestClustering = vi
          .fn()
          .mockImplementation(async ({ projectId }: { projectId: string }) => {
            if (projectId === "p1") throw new Error("boom");
          });

        const summary = await backfillTopicClusteringSchedules({
          ...pagerOver([
            ["p1", "p2"],
            ["p3", "p4"],
            ["p5"],
          ]),
          findAlreadyScheduledProjectIds: noneScheduled,
          requestClustering,
          pageSize: 2,
        });

        expect(summary).toEqual({
          succeeded: 4,
          failed: 1,
          skipped: 0,
          scanned: 5,
        });
      });
    });
  });

  describe("given there are no eligible projects", () => {
    describe("when the walk runs", () => {
      it("returns a zeroed summary without touching the bootstrap command", async () => {
        const requestClustering = vi.fn();

        const summary = await backfillTopicClusteringSchedules({
          ...pagerOver([[]]),
          findAlreadyScheduledProjectIds: noneScheduled,
          requestClustering,
          pageSize: 10,
        });

        expect(summary).toEqual({
          succeeded: 0,
          failed: 0,
          skipped: 0,
          scanned: 0,
        });
        expect(requestClustering).not.toHaveBeenCalled();
      });
    });
  });
});

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    set: vi.fn(async (key: string, value: string, ...rest: unknown[]) => {
      const nx = rest.includes("NX");
      if (nx && store.has(key)) return null;
      store.set(key, value);
      return "OK";
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

describe("seedClusteringSchedules", () => {
  const oneProjectDeps = (requestClustering = vi.fn().mockResolvedValue(undefined)) => ({
    ...pagerOver([["p1"]]),
    findAlreadyScheduledProjectIds: noneScheduled,
    requestClustering,
    pageSize: 10,
  });

  describe("given no Redis", () => {
    it("runs the walk on every call", async () => {
      const requestClustering = vi.fn().mockResolvedValue(undefined);
      await seedClusteringSchedules({
        ...oneProjectDeps(requestClustering),
        redis: null,
      });
      await seedClusteringSchedules({
        ...oneProjectDeps(requestClustering),
        redis: null,
      });
      expect(requestClustering).toHaveBeenCalledTimes(2);
    });
  });

  describe("given a fresh install with no eligible projects", () => {
    it("marks the seed done so later boots skip the scan", async () => {
      const redis = fakeRedis();
      const requestClustering = vi.fn();
      await seedClusteringSchedules({
        ...pagerOver([[]]),
        findAlreadyScheduledProjectIds: noneScheduled,
        requestClustering,
        redis: redis as any,
      });

      const requestClusteringAgain = vi.fn();
      await seedClusteringSchedules({
        ...pagerOver([["p1"]]),
        findAlreadyScheduledProjectIds: noneScheduled,
        requestClustering: requestClusteringAgain,
        redis: redis as any,
      });

      expect(requestClusteringAgain).not.toHaveBeenCalled();
    });
  });

  describe("given a project failed to schedule", () => {
    it("does not mark the seed done, so the next boot retries", async () => {
      const redis = fakeRedis();
      await seedClusteringSchedules({
        ...pagerOver([["p1"]]),
        findAlreadyScheduledProjectIds: noneScheduled,
        requestClustering: vi.fn().mockRejectedValue(new Error("boom")),
        redis: redis as any,
      });

      const requestClusteringRetry = vi.fn().mockResolvedValue(undefined);
      await seedClusteringSchedules({
        ...pagerOver([["p1"]]),
        findAlreadyScheduledProjectIds: noneScheduled,
        requestClustering: requestClusteringRetry,
        redis: redis as any,
      });

      expect(requestClusteringRetry).toHaveBeenCalledWith({ projectId: "p1" });
    });

    it("releases the claim so another replica is not blocked", async () => {
      const redis = fakeRedis();
      await seedClusteringSchedules({
        ...pagerOver([["p1"]]),
        findAlreadyScheduledProjectIds: noneScheduled,
        requestClustering: vi.fn().mockRejectedValue(new Error("boom")),
        redis: redis as any,
      });

      expect(redis.del).toHaveBeenCalledWith(
        "topic-clustering:schedule-seed:v1",
      );
    });
  });

  describe("given another replica holds the claim", () => {
    it("skips the walk without touching the bootstrap command", async () => {
      const redis = fakeRedis();
      await redis.set(
        "topic-clustering:schedule-seed:v1",
        "1",
        "EX",
        3600,
        "NX",
      );

      const requestClustering = vi.fn();
      const summary = await seedClusteringSchedules({
        ...pagerOver([["p1"]]),
        findAlreadyScheduledProjectIds: noneScheduled,
        requestClustering,
        redis: redis as any,
      });

      expect(requestClustering).not.toHaveBeenCalled();
      expect(summary).toEqual({
        succeeded: 0,
        failed: 0,
        skipped: 0,
        scanned: 0,
      });
    });
  });
});
