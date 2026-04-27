import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AnalyticsService,
  getAnalyticsService,
  resetAnalyticsService,
} from "../analytics.service";
import type { AnalyticsBackend } from "../types";

/**
 * Create a fake analytics backend for testing
 */
function createFakeBackend(options?: {
  available?: boolean;
  timeseriesResult?: {
    currentPeriod: { date: string; count: number }[];
    previousPeriod: { date: string; count: number }[];
  };
  filterDataResult?: {
    options: { field: string; label: string; count: number }[];
  };
  topDocumentsResult?: {
    topDocuments: { documentId: string; count: number; traceId: string }[];
    totalUniqueDocuments: number;
  };
  feedbacksResult?: {
    events: { event_id: string; event_type: string }[];
  };
}): AnalyticsBackend & {
  getTimeseriesCalled: boolean;
  getDataForFilterCalled: boolean;
  getTopUsedDocumentsCalled: boolean;
  getFeedbacksCalled: boolean;
} {
  const backend = {
    getTimeseriesCalled: false,
    getDataForFilterCalled: false,
    getTopUsedDocumentsCalled: false,
    getFeedbacksCalled: false,

    isAvailable: () => options?.available ?? true,

    getTimeseries: vi.fn().mockImplementation(async () => {
      backend.getTimeseriesCalled = true;
      return (
        options?.timeseriesResult ?? {
          currentPeriod: [{ date: "2024-01-01", count: 100 }],
          previousPeriod: [{ date: "2023-12-31", count: 90 }],
        }
      );
    }),

    getDataForFilter: vi.fn().mockImplementation(async () => {
      backend.getDataForFilterCalled = true;
      return (
        options?.filterDataResult ?? {
          options: [{ field: "topic-1", label: "Topic 1", count: 50 }],
        }
      );
    }),

    getTopUsedDocuments: vi.fn().mockImplementation(async () => {
      backend.getTopUsedDocumentsCalled = true;
      return (
        options?.topDocumentsResult ?? {
          topDocuments: [{ documentId: "doc-1", count: 10, traceId: "trace-1" }],
          totalUniqueDocuments: 100,
        }
      );
    }),

    getFeedbacks: vi.fn().mockImplementation(async () => {
      backend.getFeedbacksCalled = true;
      return (
        options?.feedbacksResult ?? {
          events: [{ event_id: "event-1", event_type: "thumbs_up_down" }],
        }
      );
    }),
  };

  return backend as AnalyticsBackend & typeof backend;
}

/**
 * Create a fake Prisma client for testing
 */
function createFakePrisma() {
  return {
    project: {
      findUnique: vi.fn().mockResolvedValue({}),
    },
  } as any;
}

describe("AnalyticsService", () => {
  describe("getTimeseries", () => {
    const input = {
      projectId: "test-project",
      startDate: Date.now() - 86400000,
      endDate: Date.now(),
      filters: {},
      series: [
        {
          metric: "metadata.trace_id" as const,
          aggregation: "cardinality" as const,
        },
      ],
      timeZone: "UTC",
    };

    it("routes to CH service", async () => {
      const fakeCH = createFakeBackend({ available: true });
      const fakePrisma = createFakePrisma();

      const service = new AnalyticsService({
        chService: fakeCH,
        prisma: fakePrisma,
      });

      const result = await service.getTimeseries(input);

      expect(result.currentPeriod).toHaveLength(1);
      expect(fakeCH.getTimeseriesCalled).toBe(true);
    });
  });

  describe("getDataForFilter", () => {
    it("routes to CH service", async () => {
      const fakeCH = createFakeBackend({ available: true });
      const fakePrisma = createFakePrisma();

      const service = new AnalyticsService({
        chService: fakeCH,
        prisma: fakePrisma,
      });

      const result = await service.getDataForFilter(
        "test-project",
        "topics.topics",
        Date.now() - 86400000,
        Date.now(),
        {}
      );

      expect(result.options).toHaveLength(1);
      expect(fakeCH.getDataForFilterCalled).toBe(true);
    });
  });

  describe("getTopUsedDocuments", () => {
    it("routes to CH service", async () => {
      const fakeCH = createFakeBackend({ available: true });
      const fakePrisma = createFakePrisma();

      const service = new AnalyticsService({
        chService: fakeCH,
        prisma: fakePrisma,
      });

      const result = await service.getTopUsedDocuments(
        "test-project",
        Date.now() - 86400000,
        Date.now(),
        {}
      );

      expect(result.topDocuments).toHaveLength(1);
      expect(fakeCH.getTopUsedDocumentsCalled).toBe(true);
    });
  });

  describe("getFeedbacks", () => {
    it("routes to CH service", async () => {
      const fakeCH = createFakeBackend({ available: true });
      const fakePrisma = createFakePrisma();

      const service = new AnalyticsService({
        chService: fakeCH,
        prisma: fakePrisma,
      });

      const result = await service.getFeedbacks(
        "test-project",
        Date.now() - 86400000,
        Date.now(),
        {}
      );

      expect(result.events).toHaveLength(1);
      expect(fakeCH.getFeedbacksCalled).toBe(true);
    });
  });
});

describe("getAnalyticsService", () => {
  beforeEach(() => {
    resetAnalyticsService();
  });

  it("returns a singleton instance", () => {
    const service1 = getAnalyticsService();
    const service2 = getAnalyticsService();

    expect(service1).toBe(service2);
  });
});
