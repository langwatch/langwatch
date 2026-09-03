import { describe, expect, it, vi } from "vitest";
import { LegacyImportTopicClusteringMigration } from "../legacy-import.topic-clustering.migration";
import type { TopicClusteringRepository } from "../../repositories/topic-clustering.repository";

/**
 * Unit tests for the ADR-051 legacy-project schedule seed. Only the
 * boundaries are stubbed — the repository's paging query, the
 * already-scheduled lookup, and the bootstrap command. The paging loop, the
 * outcome counters, and the skip/failure bookkeeping under test stay real.
 */

/** A fake repository whose eligible-project walk serves `pages` in order, then empties. */
function fakeRepository(overrides: { pages: string[][]; alreadyScheduled?: string[] }) {
  const pageCalls: { afterId: string | null; take: number }[] = [];
  const scheduledLookups: string[][] = [];
  const repository: TopicClusteringRepository = {
    tryFindProject: vi.fn(),
    findTopicIndexRows: vi.fn(),
    findModelTopics: vi.fn(),
    findModelSubtopics: vi.fn(),
    recordClusteringCost: vi.fn(),
    tryFindTopicModelCursor: vi.fn(),
    findSeedTopicRows: vi.fn(),
    findProjectsWithTopicsPage: vi.fn(),
    findEligibleProjectsPage: async ({ afterId, take }) => {
      pageCalls.push({ afterId, take });
      const index = pageCalls.length - 1;
      return (overrides.pages[index] ?? []).map((id) => ({ id }));
    },
    findOwnedTopicModelProjectIds: vi.fn(),
    findAlreadyScheduledProjectIds: async (projectIds: string[]) => {
      scheduledLookups.push(projectIds);
      return overrides.alreadyScheduled ?? [];
    },
  };
  return { repository, pageCalls, scheduledLookups };
}

function makeMigration(
  repository: TopicClusteringRepository,
  options: {
    requestClustering?: (args: {
      tenantId: string;
      occurredAt: number;
      trigger: "bootstrap";
    }) => Promise<void>;
    redis?: never;
    schedulePageSize?: number;
  } = {},
) {
  return LegacyImportTopicClusteringMigration.create({
    repository,
    redis: options.redis ?? null,
    commands: {
      recordTopics: vi.fn().mockResolvedValue(undefined),
      requestClustering: vi.fn(options.requestClustering ?? (async () => undefined)),
    },
    schedulePageSize: options.schedulePageSize,
  });
}

describe("backfillTopicClusteringSchedules", () => {
  describe("given every project bootstraps cleanly", () => {
    describe("when the walk runs", () => {
      it("counts one success per project and no failures", async () => {
        const requestClustering = vi.fn().mockResolvedValue(undefined);
        const migration = makeMigration(
          fakeRepository({ pages: [["p1", "p2", "p3"]] }).repository,
          {
            requestClustering,
          },
        );

        const summary = await migration.seedClusteringSchedules();

        expect(summary).toEqual({ succeeded: 3, failed: 0, skipped: 0, scanned: 3 });
        expect(requestClustering).toHaveBeenCalledTimes(3);
      });
    });
  });

  describe("given one project's bootstrap request throws", () => {
    describe("when the walk reaches it", () => {
      const failing = vi.fn().mockImplementation(async ({ tenantId }: { tenantId: string }) => {
        if (tenantId === "p2") throw new Error("boom");
      });

      it("continues bootstrapping the projects after it", async () => {
        const migration = makeMigration(
          fakeRepository({ pages: [["p1", "p2", "p3", "p4"]] }).repository,
          { requestClustering: failing },
        );

        const summary = await migration.seedClusteringSchedules();

        expect(failing.mock.calls.map(([args]) => args.tenantId)).toEqual(["p1", "p2", "p3", "p4"]);
        expect(summary.scanned).toBe(4);
      });

      it("reports the real outcome split rather than a blanket total", async () => {
        const migration = makeMigration(
          fakeRepository({ pages: [["p1", "p2", "p3", "p4"]] }).repository,
          { requestClustering: failing },
        );

        const summary = await migration.seedClusteringSchedules();

        expect(summary).toEqual({ succeeded: 3, failed: 1, skipped: 0, scanned: 4 });
      });
    });
  });

  describe("given some projects already have a scheduled wake", () => {
    describe("when the walk runs", () => {
      it("counts them as skipped without issuing a bootstrap request", async () => {
        const requestClustering = vi.fn().mockResolvedValue(undefined);
        const migration = makeMigration(
          fakeRepository({ pages: [["p1", "p2", "p3"]], alreadyScheduled: ["p1", "p3"] })
            .repository,
          { requestClustering },
        );

        const summary = await migration.seedClusteringSchedules();

        expect(summary).toEqual({ succeeded: 1, failed: 0, skipped: 2, scanned: 3 });
        expect(requestClustering.mock.calls.map(([args]) => args.tenantId)).toEqual(["p2"]);
      });
    });
  });

  describe("given more projects than fit in one page", () => {
    describe("when the walk runs", () => {
      it("bootstraps every project across all pages", async () => {
        const requestClustering = vi.fn().mockResolvedValue(undefined);
        const migration = makeMigration(
          fakeRepository({ pages: [["p1", "p2"], ["p3", "p4"], ["p5"]] }).repository,
          { requestClustering, schedulePageSize: 2 },
        );

        const summary = await migration.seedClusteringSchedules();

        expect(summary.succeeded).toBe(5);
        expect(requestClustering.mock.calls.map(([args]) => args.tenantId)).toEqual([
          "p1",
          "p2",
          "p3",
          "p4",
          "p5",
        ]);
      });

      it("advances the keyset cursor to the last id of the previous page", async () => {
        const fake = fakeRepository({ pages: [["p1", "p2"], ["p3", "p4"], ["p5"]] });
        const migration = makeMigration(fake.repository, { schedulePageSize: 2 });

        await migration.seedClusteringSchedules();

        expect(fake.pageCalls).toEqual([
          { afterId: null, take: 2 },
          { afterId: "p2", take: 2 },
          { afterId: "p4", take: 2 },
        ]);
      });

      it("stops on a short page instead of querying again", async () => {
        const fake = fakeRepository({ pages: [["p1", "p2"], ["p3"]] });
        const migration = makeMigration(fake.repository, { schedulePageSize: 2 });

        await migration.seedClusteringSchedules();

        expect(fake.pageCalls).toHaveLength(2);
      });

      it("looks up already-scheduled projects once per page, scoped to that page", async () => {
        const fake = fakeRepository({ pages: [["p1", "p2"], ["p3"]] });
        const migration = makeMigration(fake.repository, { schedulePageSize: 2 });

        await migration.seedClusteringSchedules();

        expect(fake.scheduledLookups).toEqual([["p1", "p2"], ["p3"]]);
      });
    });
  });

  describe("given a project fails on a page that is not the last one", () => {
    describe("when the walk runs", () => {
      it("keeps paging past the failure", async () => {
        const failingFirst = vi
          .fn()
          .mockImplementation(async ({ tenantId }: { tenantId: string }) => {
            if (tenantId === "p1") throw new Error("boom");
          });
        const migration = makeMigration(
          fakeRepository({ pages: [["p1", "p2"], ["p3", "p4"], ["p5"]] }).repository,
          { requestClustering: failingFirst, schedulePageSize: 2 },
        );

        const summary = await migration.seedClusteringSchedules();

        expect(summary).toEqual({ succeeded: 4, failed: 1, skipped: 0, scanned: 5 });
      });
    });
  });

  describe("given there are no eligible projects", () => {
    describe("when the walk runs", () => {
      it("returns a zeroed summary without touching the bootstrap command", async () => {
        const requestClustering = vi.fn();
        const migration = makeMigration(fakeRepository({ pages: [[]] }).repository, {
          requestClustering,
        });

        const summary = await migration.seedClusteringSchedules();

        expect(summary).toEqual({ succeeded: 0, failed: 0, skipped: 0, scanned: 0 });
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

describe("seedClusteringSchedules redis coordination", () => {
  const oneProjectMigration = (
    redis: ReturnType<typeof fakeRedis>,
    requestClustering = vi.fn().mockResolvedValue(undefined),
  ) =>
    LegacyImportTopicClusteringMigration.create({
      repository: fakeRepository({ pages: [["p1"]] }).repository,
      redis: redis as never,
      commands: {
        recordTopics: vi.fn().mockResolvedValue(undefined),
        requestClustering,
      },
    });

  describe("given no Redis", () => {
    it("runs the walk on every call", async () => {
      const requestClustering = vi.fn().mockResolvedValue(undefined);
      await makeMigration(fakeRepository({ pages: [["p1"]] }).repository, {
        requestClustering,
      }).seedClusteringSchedules();
      await makeMigration(fakeRepository({ pages: [["p1"]] }).repository, {
        requestClustering,
      }).seedClusteringSchedules();
      expect(requestClustering).toHaveBeenCalledTimes(2);
    });
  });

  describe("given a fresh install with no eligible projects", () => {
    it("marks the seed done so later boots skip the scan", async () => {
      const redis = fakeRedis();
      const requestClustering = vi.fn();
      await LegacyImportTopicClusteringMigration.create({
        repository: fakeRepository({ pages: [[]] }).repository,
        redis: redis as never,
        commands: {
          recordTopics: vi.fn().mockResolvedValue(undefined),
          requestClustering,
        },
      }).seedClusteringSchedules();

      const requestClusteringAgain = vi.fn();
      await oneProjectMigration(redis, requestClusteringAgain).seedClusteringSchedules();

      expect(requestClusteringAgain).not.toHaveBeenCalled();
    });
  });

  describe("given a project failed to schedule", () => {
    it("does not mark the seed done, so the next boot retries", async () => {
      const redis = fakeRedis();
      await oneProjectMigration(
        redis,
        vi.fn().mockRejectedValue(new Error("boom")),
      ).seedClusteringSchedules();

      const requestClusteringRetry = vi.fn().mockResolvedValue(undefined);
      await oneProjectMigration(redis, requestClusteringRetry).seedClusteringSchedules();

      expect(requestClusteringRetry).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "p1" }),
      );
    });

    it("releases the claim so another replica is not blocked", async () => {
      const redis = fakeRedis();
      await oneProjectMigration(
        redis,
        vi.fn().mockRejectedValue(new Error("boom")),
      ).seedClusteringSchedules();

      expect(redis.del).toHaveBeenCalledWith("topic-clustering:schedule-seed:v1");
    });
  });

  describe("given another replica holds the claim", () => {
    it("skips the walk without touching the bootstrap command", async () => {
      const redis = fakeRedis();
      await redis.set("topic-clustering:schedule-seed:v1", "1", "EX", 3600, "NX");

      const requestClustering = vi.fn();
      const summary = await oneProjectMigration(redis, requestClustering).seedClusteringSchedules();

      expect(requestClustering).not.toHaveBeenCalled();
      expect(summary).toEqual({ succeeded: 0, failed: 0, skipped: 0, scanned: 0 });
    });
  });
});
