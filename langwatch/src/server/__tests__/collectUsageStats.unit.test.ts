import { beforeEach, describe, expect, it, vi } from "vitest";
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

const mockGetClickHouseClientForOrganization = vi.fn();

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForOrganization: (...args: unknown[]) =>
    mockGetClickHouseClientForOrganization(...args),
}));

import { prisma } from "~/server/db";

describe("collectUsageStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when instanceId is invalid", () => {
    it("throws an error", async () => {
      await expect(collectUsageStats("bad")).rejects.toThrow(
        "Invalid instance ID",
      );
    });
  });

  describe("when organization has zero projects", () => {
    it("returns zero for traces and scenarios", async () => {
      vi.mocked(prisma.project.findMany).mockResolvedValue([]);
      mockGetClickHouseClientForOrganization.mockResolvedValue(null);

      const result = await collectUsageStats("inst__org-1");

      expect(result.totalTraces).toBe(0);
      expect(result.totalScenarioEvents).toBe(0);
    });
  });

  describe("when ClickHouse is available", () => {
    it("queries CH for trace and scenario counts", async () => {
      vi.mocked(prisma.project.findMany).mockResolvedValue([
        { id: "proj-1" },
      ] as any);
      mockGetClickHouseClientForOrganization.mockResolvedValue({
        query: mockClickHouseQuery,
      } as any);

      mockClickHouseQuery
        .mockResolvedValueOnce({
          json: () => Promise.resolve([{ Total: "200" }]),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve([{ Total: "75" }]),
        });

      const result = await collectUsageStats("inst__org-1");

      expect(result.totalTraces).toBe(200);
      expect(result.totalScenarioEvents).toBe(75);
      expect(mockClickHouseQuery).toHaveBeenCalledTimes(2);
    });
  });

  describe("when CH client is null", () => {
    it("returns zero counts", async () => {
      vi.mocked(prisma.project.findMany).mockResolvedValue([
        { id: "proj-1" },
      ] as any);
      mockGetClickHouseClientForOrganization.mockResolvedValue(null);

      const result = await collectUsageStats("inst__org-1");

      expect(result.totalTraces).toBe(0);
      expect(result.totalScenarioEvents).toBe(0);
      expect(mockClickHouseQuery).not.toHaveBeenCalled();
    });
  });
});
