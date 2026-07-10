import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TriggerFire,
  TriggerFireHistoryRepository,
  TriggerFireStats,
} from "../repositories/trigger-fire-history.repository";
import { TriggerFireHistoryService } from "../trigger-fire-history.service";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

describe("TriggerFireHistoryService", () => {
  const stats: TriggerFireStats[] = [
    {
      triggerId: "trigger_1",
      lastFiredAt: new Date("2026-07-09T10:00:00Z"),
      recentFireCount: 12,
      currentlyFiring: true,
    },
  ];
  const fires: TriggerFire[] = [
    {
      id: "sent_1",
      triggerId: "trigger_1",
      customGraphId: "graph_1",
      createdAt: new Date("2026-07-09T10:00:00Z"),
      resolvedAt: null,
    },
  ];

  let repo: TriggerFireHistoryRepository;
  let service: TriggerFireHistoryService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00Z"));
    repo = {
      findAllStatsForProject: vi.fn().mockResolvedValue(stats),
      findAllRecentByTriggerId: vi.fn().mockResolvedValue(fires),
    };
    service = new TriggerFireHistoryService(repo);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("given a project with fire history", () => {
    describe("when fetching fire stats for the project", () => {
      it("scopes the repository read to the projectId", async () => {
        await service.getAllFireStatsForProject({ projectId: "proj_123" });

        expect(repo.findAllStatsForProject).toHaveBeenCalledWith(
          expect.objectContaining({ projectId: "proj_123" }),
        );
      });

      it("computes the fire-count window as the trailing 30 days", async () => {
        await service.getAllFireStatsForProject({ projectId: "proj_123" });

        const call = vi.mocked(repo.findAllStatsForProject).mock.calls[0]![0];
        expect(call.firesSince.getTime()).toBe(Date.now() - THIRTY_DAYS_MS);
      });

      it("returns the repository's per-trigger rollup", async () => {
        const result = await service.getAllFireStatsForProject({
          projectId: "proj_123",
        });

        expect(result).toEqual(stats);
      });
    });

    describe("when fetching recent fires for one trigger", () => {
      it("scopes the lookup to the project, trigger, and limit", async () => {
        await service.getAllRecentFiresForTrigger({
          projectId: "proj_123",
          triggerId: "trigger_1",
          limit: 20,
        });

        expect(repo.findAllRecentByTriggerId).toHaveBeenCalledWith({
          projectId: "proj_123",
          triggerId: "trigger_1",
          limit: 20,
        });
      });

      it("returns the repository's fire rows unchanged", async () => {
        const result = await service.getAllRecentFiresForTrigger({
          projectId: "proj_123",
          triggerId: "trigger_1",
          limit: 20,
        });

        expect(result).toEqual(fires);
        // The metadata-only guarantee (no traceId / captured content) is
        // enforced by the repository's `select`, not by this service — the
        // service is a passthrough, so asserting the shape here would only
        // test the fixture. That guard is asserted directly against the
        // prisma `select` in trigger-fire-history.prisma.repository.unit.test.ts.
      });
    });
  });
});
