import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectUsageStats } from "../collectUsageStats";

const mockEsClient = {
  count: vi.fn(),
};
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

vi.mock("~/server/elasticsearch", () => ({
  esClient: vi.fn().mockResolvedValue({
    count: (...args: unknown[]) => mockEsClient.count(...args),
  }),
  TRACE_INDEX: { alias: "search-traces-alias", all: "search-traces-*" },
  SCENARIO_EVENTS_INDEX: { alias: "scenario-events-alias" },
}));

vi.mock("~/server/clickhouse/client", () => ({
  getClickHouseClient: vi.fn(),
}));

import { prisma } from "~/server/db";
import { getClickHouseClient } from "~/server/clickhouse/client";

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
      vi.mocked(getClickHouseClient).mockReturnValue(null);

      const result = await collectUsageStats("inst__org-1");

      expect(result.totalTraces).toBe(0);
      expect(result.totalScenarioEvents).toBe(0);
    });
  });

  describe("when all projects use ES (flag off)", () => {
    it("queries ES for trace and scenario counts", async () => {
      vi.mocked(prisma.project.findMany).mockResolvedValue([
        {
          id: "proj-1",
          featureClickHouseDataSourceTraces: false,
          featureClickHouseDataSourceSimulations: false,
        },
      ] as any);
      vi.mocked(getClickHouseClient).mockReturnValue(null);

      mockEsClient.count
        .mockResolvedValueOnce({ count: 100 }) // traces
        .mockResolvedValueOnce({ count: 50 }); // scenarios

      const result = await collectUsageStats("inst__org-1");

      expect(result.totalTraces).toBe(100);
      expect(result.totalScenarioEvents).toBe(50);
      expect(mockEsClient.count).toHaveBeenCalledTimes(2);
    });
  });

  describe("when all projects use CH (flag on)", () => {
    it("queries CH for trace and scenario counts, no ES calls", async () => {
      vi.mocked(prisma.project.findMany).mockResolvedValue([
        {
          id: "proj-1",
          featureClickHouseDataSourceTraces: true,
          featureClickHouseDataSourceSimulations: true,
        },
      ] as any);
      vi.mocked(getClickHouseClient).mockReturnValue({
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
      expect(mockEsClient.count).not.toHaveBeenCalled();
    });
  });

  describe("when projects have mixed flags", () => {
    it("splits between CH and ES, sums results", async () => {
      vi.mocked(prisma.project.findMany).mockResolvedValue([
        {
          id: "proj-1",
          featureClickHouseDataSourceTraces: true,
          featureClickHouseDataSourceSimulations: false,
        },
        {
          id: "proj-2",
          featureClickHouseDataSourceTraces: false,
          featureClickHouseDataSourceSimulations: true,
        },
      ] as any);
      vi.mocked(getClickHouseClient).mockReturnValue({
        query: mockClickHouseQuery,
      } as any);

      // CH trace count for proj-1
      mockClickHouseQuery.mockResolvedValueOnce({
        json: () => Promise.resolve([{ Total: "100" }]),
      });
      // ES trace count for proj-2
      mockEsClient.count.mockResolvedValueOnce({ count: 50 });
      // CH scenario count for proj-2
      mockClickHouseQuery.mockResolvedValueOnce({
        json: () => Promise.resolve([{ Total: "30" }]),
      });
      // ES scenario count for proj-1
      mockEsClient.count.mockResolvedValueOnce({ count: 20 });

      const result = await collectUsageStats("inst__org-1");

      expect(result.totalTraces).toBe(150); // 100 CH + 50 ES
      expect(result.totalScenarioEvents).toBe(50); // 30 CH + 20 ES
    });
  });

  describe("when CH client is null", () => {
    it("falls back to ES for all projects regardless of flags", async () => {
      vi.mocked(prisma.project.findMany).mockResolvedValue([
        {
          id: "proj-1",
          featureClickHouseDataSourceTraces: true,
          featureClickHouseDataSourceSimulations: true,
        },
      ] as any);
      vi.mocked(getClickHouseClient).mockReturnValue(null);

      mockEsClient.count
        .mockResolvedValueOnce({ count: 100 })
        .mockResolvedValueOnce({ count: 50 });

      const result = await collectUsageStats("inst__org-1");

      expect(result.totalTraces).toBe(100);
      expect(result.totalScenarioEvents).toBe(50);
      expect(mockClickHouseQuery).not.toHaveBeenCalled();
    });
  });
});
