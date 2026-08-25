import { beforeEach, describe, expect, it, vi } from "vitest";
import { InstanceUsageStatsClickHouseRepository } from "~/server/app-layer/usage-stats/repositories/instance-usage.clickhouse.repository";
import { collectUsageStats } from "../collectUsageStats";

const mockClickHouseQuery = vi.fn();

vi.mock("~/server/db", () => ({
  prisma: {
    project: { findMany: vi.fn() },
    annotation: { count: vi.fn().mockResolvedValue(0) },
    annotationQueue: { count: vi.fn().mockResolvedValue(0) },
    annotationQueueItem: { count: vi.fn().mockResolvedValue(0) },
    annotationScore: { count: vi.fn().mockResolvedValue(0) },
    batchEvaluation: { count: vi.fn().mockResolvedValue(0) },
    customGraph: { count: vi.fn().mockResolvedValue(0) },
    dataset: { count: vi.fn().mockResolvedValue(0) },
    datasetRecord: { count: vi.fn().mockResolvedValue(0) },
    experiment: { count: vi.fn().mockResolvedValue(0) },
    trigger: { count: vi.fn().mockResolvedValue(0) },
    workflow: { count: vi.fn().mockResolvedValue(0) },
  },
}));

import { prisma } from "~/server/db";

/** The service under test, reading through a real repository over a fake
 *  resolveClient — mirrors how the org's ClickHouse client is resolved in
 *  production without touching the real ClickHouse module. */
const resolveClient = vi.fn();
function repositoryOver(client: unknown) {
  resolveClient.mockResolvedValue(client);
  return new InstanceUsageStatsClickHouseRepository(resolveClient);
}

describe("collectUsageStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when instanceId is invalid", () => {
    it("throws an error", async () => {
      await expect(
        collectUsageStats({
          instanceId: "bad",
          repository: repositoryOver(null),
        }),
      ).rejects.toThrow("Invalid instance ID");
    });
  });

  describe("when organization has zero projects", () => {
    it("returns zero for traces and scenarios", async () => {
      vi.mocked(prisma.project.findMany).mockResolvedValue([]);

      const result = await collectUsageStats({
        instanceId: "inst__org-1",
        repository: repositoryOver(null),
      });

      expect(result.totalTraces).toBe(0);
      expect(result.totalScenarioEvents).toBe(0);
    });
  });

  describe("when ClickHouse is available", () => {
    it("queries CH for trace and scenario counts", async () => {
      vi.mocked(prisma.project.findMany).mockResolvedValue([{ id: "proj-1" }] as any);

      mockClickHouseQuery
        .mockResolvedValueOnce({
          json: () => Promise.resolve([{ Total: "200" }]),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve([{ Total: "75" }]),
        });

      const result = await collectUsageStats({
        instanceId: "inst__org-1",
        repository: repositoryOver({ query: mockClickHouseQuery }),
      });

      expect(result.totalTraces).toBe(200);
      expect(result.totalScenarioEvents).toBe(75);
      expect(mockClickHouseQuery).toHaveBeenCalledTimes(2);
    });
  });

  describe("when CH client is null", () => {
    it("returns zero counts", async () => {
      vi.mocked(prisma.project.findMany).mockResolvedValue([{ id: "proj-1" }] as any);

      const result = await collectUsageStats({
        instanceId: "inst__org-1",
        repository: repositoryOver(null),
      });

      expect(result.totalTraces).toBe(0);
      expect(result.totalScenarioEvents).toBe(0);
      expect(mockClickHouseQuery).not.toHaveBeenCalled();
    });
  });
});
