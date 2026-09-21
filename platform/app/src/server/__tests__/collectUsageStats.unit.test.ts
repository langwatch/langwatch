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

  describe("when the install carries no organization", () => {
    it("throws, because there is nothing to report", async () => {
      await expect(
        collectUsageStats({
          organizationIds: [],
          repository: repositoryOver(null),
        }),
      ).rejects.toThrow(
        "an install with no organization has nothing to report",
      );
    });
  });

  describe("when the install has zero projects", () => {
    it("returns zero for traces and scenarios", async () => {
      vi.mocked(prisma.project.findMany).mockResolvedValue([]);

      const result = await collectUsageStats({
        organizationIds: ["org-1"],
        repository: repositoryOver(null),
      });

      expect(result.totalTraces).toBe(0);
      expect(result.totalScenarioEvents).toBe(0);
    });
  });

  describe("when ClickHouse is available", () => {
    it("queries CH for trace and scenario counts", async () => {
      vi.mocked(prisma.project.findMany).mockResolvedValue([
        { id: "proj-1" },
      ] as any);

      mockClickHouseQuery
        .mockResolvedValueOnce({
          json: () => Promise.resolve([{ Total: "200" }]),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve([{ Total: "75" }]),
        });

      const result = await collectUsageStats({
        organizationIds: ["org-1"],
        repository: repositoryOver({ query: mockClickHouseQuery }),
      });

      expect(result.totalTraces).toBe(200);
      expect(result.totalScenarioEvents).toBe(75);
      expect(mockClickHouseQuery).toHaveBeenCalledTimes(2);
    });
  });

  describe("when the install carries two organizations", () => {
    it("adds their counts together, because one install is one report", async () => {
      vi.mocked(prisma.project.findMany).mockResolvedValue([
        { id: "proj-1" },
      ] as any);

      mockClickHouseQuery
        .mockResolvedValueOnce({
          json: () => Promise.resolve([{ Total: "10" }]),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve([{ Total: "20" }]),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve([{ Total: "1" }]),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve([{ Total: "2" }]),
        });

      const result = await collectUsageStats({
        organizationIds: ["org-1", "org-2"],
        repository: repositoryOver({ query: mockClickHouseQuery }),
      });

      expect(result.totalTraces).toBe(30);
      expect(result.totalScenarioEvents).toBe(3);
    });
  });

  describe("when CH client is null", () => {
    it("returns zero counts", async () => {
      vi.mocked(prisma.project.findMany).mockResolvedValue([
        { id: "proj-1" },
      ] as any);

      const result = await collectUsageStats({
        organizationIds: ["org-1"],
        repository: repositoryOver(null),
      });

      expect(result.totalTraces).toBe(0);
      expect(result.totalScenarioEvents).toBe(0);
      expect(mockClickHouseQuery).not.toHaveBeenCalled();
    });
  });
});
