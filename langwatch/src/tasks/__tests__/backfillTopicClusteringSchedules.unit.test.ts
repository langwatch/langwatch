import { beforeEach, describe, expect, it, vi } from "vitest";

// Boundary stubs for the `execute()` entrypoint: the app-layer bootstrap and
// the Prisma client. `vi.mock` is hoisted above these imports by vitest.
const requestClusteringMock = vi.fn();
vi.mock("~/server/app-layer/presets", () => ({
  initializeDefaultApp: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    topicClustering: { requestClustering: requestClusteringMock },
  }),
}));
vi.mock("../../server/db", () => ({
  prisma: {
    project: { findMany: vi.fn() },
    processManagerInstance: { findMany: vi.fn() },
  },
}));

import { prisma as mockedPrisma } from "../../server/db";
import execute, {
  type BackfillDeps,
  backfillTopicClusteringSchedules,
} from "../backfillTopicClusteringSchedules";

/**
 * Unit tests for the ADR-051 backfill walk. Only the boundaries are mocked —
 * the Prisma paging query, the already-scheduled lookup, and the bootstrap
 * command. The paging loop, the outcome counters, and the skip/failure
 * bookkeeping under test stay real.
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

describe("execute", () => {
  const projectFindMany = vi.mocked(mockedPrisma.project.findMany);
  const instanceFindMany = vi.mocked(
    mockedPrisma.processManagerInstance.findMany,
  );

  beforeEach(() => {
    vi.clearAllMocks();
    instanceFindMany.mockResolvedValue([] as never);
    requestClusteringMock.mockResolvedValue(undefined);
  });

  describe("given every project bootstraps cleanly", () => {
    describe("when the task runs", () => {
      it("resolves so the Helm hook reports success", async () => {
        projectFindMany
          .mockResolvedValueOnce([{ id: "p1" }] as never)
          .mockResolvedValue([] as never);

        await expect(execute()).resolves.toBeUndefined();
        expect(requestClusteringMock).toHaveBeenCalledWith(
          expect.objectContaining({ tenantId: "p1", trigger: "bootstrap" }),
        );
      });
    });
  });

  describe("given at least one project failed to schedule", () => {
    describe("when the task runs", () => {
      it("throws so the process exits non-zero on a partial backfill", async () => {
        projectFindMany
          .mockResolvedValueOnce([{ id: "p1" }, { id: "p2" }] as never)
          .mockResolvedValue([] as never);
        requestClusteringMock.mockImplementation(
          async ({ tenantId }: { tenantId: string }) => {
            if (tenantId === "p2") throw new Error("boom");
          },
        );

        await expect(execute()).rejects.toThrow(
          /backfill incomplete: 1 of 2 projects failed/i,
        );
      });
    });
  });

  describe("given the project table is paged", () => {
    describe("when the task runs", () => {
      it("scopes the already-scheduled lookup by projectId and the process name", async () => {
        projectFindMany
          .mockResolvedValueOnce([{ id: "p1" }] as never)
          .mockResolvedValue([] as never);

        await execute();

        expect(instanceFindMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              projectId: { in: ["p1"] },
              processName: "topicClustering",
            }),
          }),
        );
      });
    });
  });
});
