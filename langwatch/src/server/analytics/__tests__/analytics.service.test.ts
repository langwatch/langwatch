import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsService, getAnalyticsService } from "../analytics.service";

// Mock the ES and CH services
vi.mock("../elasticsearch-analytics.service", () => ({
  getElasticsearchAnalyticsService: vi.fn(() => ({
    getTimeseries: vi.fn().mockResolvedValue({
      currentPeriod: [{ date: "2024-01-01", count: 100 }],
      previousPeriod: [{ date: "2023-12-31", count: 90 }],
    }),
    getDataForFilter: vi.fn().mockResolvedValue({
      options: [{ field: "topic-1", label: "Topic 1", count: 50 }],
    }),
    getTopUsedDocuments: vi.fn().mockResolvedValue({
      topDocuments: [{ documentId: "doc-1", count: 10, traceId: "trace-1" }],
      totalUniqueDocuments: 100,
    }),
    getFeedbacks: vi.fn().mockResolvedValue({
      events: [{ event_id: "event-1", event_type: "thumbs_up_down" }],
    }),
  })),
}));

vi.mock("../clickhouse/clickhouse-analytics.service", () => ({
  getClickHouseAnalyticsService: vi.fn(() => ({
    isAvailable: vi.fn().mockReturnValue(true),
    getTimeseries: vi.fn().mockResolvedValue({
      currentPeriod: [{ date: "2024-01-01", count: 100 }],
      previousPeriod: [{ date: "2023-12-31", count: 90 }],
    }),
    getDataForFilter: vi.fn().mockResolvedValue({
      options: [{ field: "topic-1", label: "Topic 1", count: 50 }],
    }),
    getTopUsedDocuments: vi.fn().mockResolvedValue({
      topDocuments: [{ documentId: "doc-1", count: 10, traceId: "trace-1" }],
      totalUniqueDocuments: 100,
    }),
    getFeedbacks: vi.fn().mockResolvedValue({
      events: [{ event_id: "event-1", event_type: "thumbs_up_down" }],
    }),
  })),
}));

// Mock Prisma
const mockPrisma = {
  project: {
    findUnique: vi.fn(),
  },
} as any;

// Mock env
vi.mock("../../../env.mjs", () => ({
  env: {
    ANALYTICS_COMPARISON_MODE: "false",
  },
}));

describe("AnalyticsService", () => {
  let service: AnalyticsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AnalyticsService(mockPrisma);
  });

  describe("isClickHouseEnabled", () => {
    it("should return false when project does not have feature flag enabled", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        featureClickHouseDataSourceTraces: false,
      });

      const result = await service.isClickHouseEnabled("test-project");

      expect(result).toBe(false);
      expect(mockPrisma.project.findUnique).toHaveBeenCalledWith({
        where: { id: "test-project" },
        select: { featureClickHouseDataSourceTraces: true },
      });
    });

    it("should return true when project has feature flag enabled", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        featureClickHouseDataSourceTraces: true,
      });

      const result = await service.isClickHouseEnabled("test-project");

      expect(result).toBe(true);
    });

    it("should return false when project is not found", async () => {
      mockPrisma.project.findUnique.mockResolvedValue(null);

      const result = await service.isClickHouseEnabled("test-project");

      expect(result).toBe(false);
    });

    it("should return false when Prisma throws an error", async () => {
      mockPrisma.project.findUnique.mockRejectedValue(new Error("DB error"));

      const result = await service.isClickHouseEnabled("test-project");

      expect(result).toBe(false);
    });
  });

  describe("isComparisonModeEnabled", () => {
    it("should return false when ANALYTICS_COMPARISON_MODE is not 'true'", () => {
      const result = service.isComparisonModeEnabled();

      expect(result).toBe(false);
    });
  });

  describe("getTimeseries", () => {
    const input = {
      projectId: "test-project",
      startDate: Date.now() - 86400000,
      endDate: Date.now(),
      filters: {},
      series: [
        {
          metric: "metadata.trace_id",
          aggregation: "cardinality" as const,
        },
      ],
    };

    it("should use ES service when ClickHouse is not enabled", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        featureClickHouseDataSourceTraces: false,
      });

      const result = await service.getTimeseries(input);

      expect(result.currentPeriod).toHaveLength(1);
      expect(result.previousPeriod).toHaveLength(1);
    });

    it("should use CH service when ClickHouse is enabled", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        featureClickHouseDataSourceTraces: true,
      });

      const result = await service.getTimeseries(input);

      expect(result.currentPeriod).toHaveLength(1);
    });
  });

  describe("getDataForFilter", () => {
    it("should use ES service when ClickHouse is not enabled", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        featureClickHouseDataSourceTraces: false,
      });

      const result = await service.getDataForFilter(
        "test-project",
        "topics.topics",
        Date.now() - 86400000,
        Date.now(),
        {}
      );

      expect(result.options).toHaveLength(1);
      expect(result.options[0]?.field).toBe("topic-1");
    });

    it("should use CH service when ClickHouse is enabled", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        featureClickHouseDataSourceTraces: true,
      });

      const result = await service.getDataForFilter(
        "test-project",
        "topics.topics",
        Date.now() - 86400000,
        Date.now(),
        {}
      );

      expect(result.options).toHaveLength(1);
    });
  });

  describe("getTopUsedDocuments", () => {
    it("should use ES service when ClickHouse is not enabled", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        featureClickHouseDataSourceTraces: false,
      });

      const result = await service.getTopUsedDocuments(
        "test-project",
        Date.now() - 86400000,
        Date.now(),
        {}
      );

      expect(result.topDocuments).toHaveLength(1);
      expect(result.totalUniqueDocuments).toBe(100);
    });

    it("should use CH service when ClickHouse is enabled", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        featureClickHouseDataSourceTraces: true,
      });

      const result = await service.getTopUsedDocuments(
        "test-project",
        Date.now() - 86400000,
        Date.now(),
        {}
      );

      expect(result.topDocuments).toHaveLength(1);
    });
  });

  describe("getFeedbacks", () => {
    it("should use ES service when ClickHouse is not enabled", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        featureClickHouseDataSourceTraces: false,
      });

      const result = await service.getFeedbacks(
        "test-project",
        Date.now() - 86400000,
        Date.now(),
        {}
      );

      expect(result.events).toHaveLength(1);
    });

    it("should use CH service when ClickHouse is enabled", async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        featureClickHouseDataSourceTraces: true,
      });

      const result = await service.getFeedbacks(
        "test-project",
        Date.now() - 86400000,
        Date.now(),
        {}
      );

      expect(result.events).toHaveLength(1);
    });
  });
});

describe("getAnalyticsService", () => {
  it("should return a singleton instance", () => {
    const service1 = getAnalyticsService();
    const service2 = getAnalyticsService();

    expect(service1).toBe(service2);
  });
});
