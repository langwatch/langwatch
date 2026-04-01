import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AnalyticsService,
  createAnalyticsService,
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
function createFakePrisma(options?: { clickhouseEnabled?: boolean }) {
  return {
    project: {
      findUnique: vi.fn().mockResolvedValue({
        featureClickHouseDataSourceTraces: options?.clickhouseEnabled ?? false,
      }),
    },
  } as any;
}

describe("AnalyticsService", () => {
  describe("isClickHouseEnabled", () => {
    it("returns false when project does not have feature flag enabled", async () => {
      const fakeES = createFakeBackend();
      const fakeCH = createFakeBackend({ available: true });
      const fakePrisma = createFakePrisma({ clickhouseEnabled: false });

      const service = new AnalyticsService({
        esService: fakeES,
        chService: fakeCH,
        prisma: fakePrisma,
      });

      const result = await service.isClickHouseEnabled("test-project");

      expect(result).toBe(false);
      expect(fakePrisma.project.findUnique).toHaveBeenCalledWith({
        where: { id: "test-project" },
        select: { featureClickHouseDataSourceTraces: true },
      });
    });

    it("returns true when project has feature flag enabled", async () => {
      const fakeES = createFakeBackend();
      const fakeCH = createFakeBackend({ available: true });
      const fakePrisma = createFakePrisma({ clickhouseEnabled: true });

      const service = new AnalyticsService({
        esService: fakeES,
        chService: fakeCH,
        prisma: fakePrisma,
      });

      const result = await service.isClickHouseEnabled("test-project");

      expect(result).toBe(true);
    });

    it("returns false when CH client is not available", async () => {
      const fakeES = createFakeBackend();
      const fakeCH = createFakeBackend({ available: false });
      const fakePrisma = createFakePrisma({ clickhouseEnabled: true });

      const service = new AnalyticsService({
        esService: fakeES,
        chService: fakeCH,
        prisma: fakePrisma,
      });

      const result = await service.isClickHouseEnabled("test-project");

      expect(result).toBe(false);
    });

    it("returns false when Prisma throws an error", async () => {
      const fakeES = createFakeBackend();
      const fakeCH = createFakeBackend({ available: true });
      const fakePrisma = {
        project: {
          findUnique: vi.fn().mockRejectedValue(new Error("DB error")),
        },
      } as any;

      const service = new AnalyticsService({
        esService: fakeES,
        chService: fakeCH,
        prisma: fakePrisma,
      });

      const result = await service.isClickHouseEnabled("test-project");

      expect(result).toBe(false);
    });
  });

  describe("isComparisonModeEnabled", () => {
    it("returns false when config does not enable comparison mode", () => {
      const service = new AnalyticsService({
        esService: createFakeBackend(),
        chService: createFakeBackend(),
        prisma: createFakePrisma(),
      });

      const result = service.isComparisonModeEnabled();

      expect(result).toBe(false);
    });

    it("returns true when config enables comparison mode", () => {
      const service = new AnalyticsService({
        esService: createFakeBackend(),
        chService: createFakeBackend(),
        prisma: createFakePrisma(),
        config: { comparisonModeEnabled: true },
      });

      const result = service.isComparisonModeEnabled();

      expect(result).toBe(true);
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
          metric: "metadata.trace_id" as const,
          aggregation: "cardinality" as const,
        },
      ],
      timeZone: "UTC",
    };

    it("routes to ES service when ClickHouse is not enabled", async () => {
      const fakeES = createFakeBackend();
      const fakeCH = createFakeBackend({ available: true });
      const fakePrisma = createFakePrisma({ clickhouseEnabled: false });

      const service = new AnalyticsService({
        esService: fakeES,
        chService: fakeCH,
        prisma: fakePrisma,
      });

      const result = await service.getTimeseries(input);

      expect(result.currentPeriod).toHaveLength(1);
      expect(fakeES.getTimeseriesCalled).toBe(true);
      expect(fakeCH.getTimeseriesCalled).toBe(false);
    });

    it("routes to CH service when ClickHouse is enabled", async () => {
      const fakeES = createFakeBackend();
      const fakeCH = createFakeBackend({ available: true });
      const fakePrisma = createFakePrisma({ clickhouseEnabled: true });

      const service = new AnalyticsService({
        esService: fakeES,
        chService: fakeCH,
        prisma: fakePrisma,
      });

      const result = await service.getTimeseries(input);

      expect(result.currentPeriod).toHaveLength(1);
      expect(fakeCH.getTimeseriesCalled).toBe(true);
      expect(fakeES.getTimeseriesCalled).toBe(false);
    });
  });

  describe("getDataForFilter", () => {
    it("routes to ES service when ClickHouse is not enabled", async () => {
      const fakeES = createFakeBackend();
      const fakeCH = createFakeBackend({ available: true });
      const fakePrisma = createFakePrisma({ clickhouseEnabled: false });

      const service = new AnalyticsService({
        esService: fakeES,
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
      expect(fakeES.getDataForFilterCalled).toBe(true);
      expect(fakeCH.getDataForFilterCalled).toBe(false);
    });

    it("routes to CH service when ClickHouse is enabled", async () => {
      const fakeES = createFakeBackend();
      const fakeCH = createFakeBackend({ available: true });
      const fakePrisma = createFakePrisma({ clickhouseEnabled: true });

      const service = new AnalyticsService({
        esService: fakeES,
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
      expect(fakeES.getDataForFilterCalled).toBe(false);
    });
  });

  describe("getTopUsedDocuments", () => {
    it("routes to ES service when ClickHouse is not enabled", async () => {
      const fakeES = createFakeBackend();
      const fakeCH = createFakeBackend({ available: true });
      const fakePrisma = createFakePrisma({ clickhouseEnabled: false });

      const service = new AnalyticsService({
        esService: fakeES,
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
      expect(fakeES.getTopUsedDocumentsCalled).toBe(true);
      expect(fakeCH.getTopUsedDocumentsCalled).toBe(false);
    });

    it("routes to CH service when ClickHouse is enabled", async () => {
      const fakeES = createFakeBackend();
      const fakeCH = createFakeBackend({ available: true });
      const fakePrisma = createFakePrisma({ clickhouseEnabled: true });

      const service = new AnalyticsService({
        esService: fakeES,
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
      expect(fakeES.getTopUsedDocumentsCalled).toBe(false);
    });
  });

  describe("getFeedbacks", () => {
    it("routes to ES service when ClickHouse is not enabled", async () => {
      const fakeES = createFakeBackend();
      const fakeCH = createFakeBackend({ available: true });
      const fakePrisma = createFakePrisma({ clickhouseEnabled: false });

      const service = new AnalyticsService({
        esService: fakeES,
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
      expect(fakeES.getFeedbacksCalled).toBe(true);
      expect(fakeCH.getFeedbacksCalled).toBe(false);
    });

    it("routes to CH service when ClickHouse is enabled", async () => {
      const fakeES = createFakeBackend();
      const fakeCH = createFakeBackend({ available: true });
      const fakePrisma = createFakePrisma({ clickhouseEnabled: true });

      const service = new AnalyticsService({
        esService: fakeES,
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
      expect(fakeES.getFeedbacksCalled).toBe(false);
    });
  });

  describe("when projection service is provided", () => {
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

    function createFakeFeatureFlagService(enabled: boolean) {
      return {
        isEnabled: vi.fn().mockResolvedValue(enabled),
      };
    }

    describe("when projection feature flag is enabled", () => {
      it("routes getTimeseries to projection service", async () => {
        const fakeES = createFakeBackend();
        const fakeCH = createFakeBackend({ available: true });
        const fakeProjection = createFakeBackend({
          available: true,
          timeseriesResult: {
            currentPeriod: [{ date: "2024-01-01", count: 200 }],
            previousPeriod: [{ date: "2023-12-31", count: 180 }],
          },
        });
        const fakePrisma = createFakePrisma({ clickhouseEnabled: true });
        const fakeFlags = createFakeFeatureFlagService(true);

        const service = new AnalyticsService({
          esService: fakeES,
          chService: fakeCH,
          projectionService: fakeProjection,
          prisma: fakePrisma,
          featureFlagService: fakeFlags,
        });

        const result = await service.getTimeseries(input);

        expect(result.currentPeriod[0]!.count).toBe(200);
        expect(fakeProjection.getTimeseriesCalled).toBe(true);
        expect(fakeCH.getTimeseriesCalled).toBe(false);
        expect(fakeES.getTimeseriesCalled).toBe(false);
      });

      it("routes getDataForFilter to projection service", async () => {
        const fakeES = createFakeBackend();
        const fakeCH = createFakeBackend({ available: true });
        const fakeProjection = createFakeBackend({
          available: true,
          filterDataResult: {
            options: [{ field: "proj-1", label: "Proj 1", count: 99 }],
          },
        });
        const fakePrisma = createFakePrisma({ clickhouseEnabled: true });
        const fakeFlags = createFakeFeatureFlagService(true);

        const service = new AnalyticsService({
          esService: fakeES,
          chService: fakeCH,
          projectionService: fakeProjection,
          prisma: fakePrisma,
          featureFlagService: fakeFlags,
        });

        const result = await service.getDataForFilter(
          "test-project",
          "topics.topics",
          Date.now() - 86400000,
          Date.now(),
          {},
        );

        expect(result.options[0]!.field).toBe("proj-1");
        expect(fakeProjection.getDataForFilterCalled).toBe(true);
        expect(fakeCH.getDataForFilterCalled).toBe(false);
      });

      it("routes getTopUsedDocuments to projection service", async () => {
        const fakeES = createFakeBackend();
        const fakeCH = createFakeBackend({ available: true });
        const fakeProjection = createFakeBackend({
          available: true,
          topDocumentsResult: {
            topDocuments: [
              { documentId: "proj-doc-1", count: 5, traceId: "trace-p1" },
            ],
            totalUniqueDocuments: 42,
          },
        });
        const fakePrisma = createFakePrisma({ clickhouseEnabled: true });
        const fakeFlags = createFakeFeatureFlagService(true);

        const service = new AnalyticsService({
          esService: fakeES,
          chService: fakeCH,
          projectionService: fakeProjection,
          prisma: fakePrisma,
          featureFlagService: fakeFlags,
        });

        const result = await service.getTopUsedDocuments(
          "test-project",
          Date.now() - 86400000,
          Date.now(),
          {},
        );

        expect(result.topDocuments[0]!.documentId).toBe("proj-doc-1");
        expect(fakeProjection.getTopUsedDocumentsCalled).toBe(true);
        expect(fakeCH.getTopUsedDocumentsCalled).toBe(false);
      });

      it("routes getFeedbacks to projection service", async () => {
        const fakeES = createFakeBackend();
        const fakeCH = createFakeBackend({ available: true });
        const fakeProjection = createFakeBackend({
          available: true,
          feedbacksResult: {
            events: [
              { event_id: "proj-ev-1", event_type: "thumbs_up_down" },
            ],
          },
        });
        const fakePrisma = createFakePrisma({ clickhouseEnabled: true });
        const fakeFlags = createFakeFeatureFlagService(true);

        const service = new AnalyticsService({
          esService: fakeES,
          chService: fakeCH,
          projectionService: fakeProjection,
          prisma: fakePrisma,
          featureFlagService: fakeFlags,
        });

        const result = await service.getFeedbacks(
          "test-project",
          Date.now() - 86400000,
          Date.now(),
          {},
        );

        expect(result.events[0]!.event_id).toBe("proj-ev-1");
        expect(fakeProjection.getFeedbacksCalled).toBe(true);
        expect(fakeCH.getFeedbacksCalled).toBe(false);
      });
    });

    describe("when projection feature flag is disabled", () => {
      it("falls through to normal CH/ES routing", async () => {
        const fakeES = createFakeBackend();
        const fakeCH = createFakeBackend({ available: true });
        const fakeProjection = createFakeBackend({ available: true });
        const fakePrisma = createFakePrisma({ clickhouseEnabled: true });
        const fakeFlags = createFakeFeatureFlagService(false);

        const service = new AnalyticsService({
          esService: fakeES,
          chService: fakeCH,
          projectionService: fakeProjection,
          prisma: fakePrisma,
          featureFlagService: fakeFlags,
        });

        const result = await service.getTimeseries(input);

        expect(result.currentPeriod).toHaveLength(1);
        expect(fakeProjection.getTimeseriesCalled).toBe(false);
        expect(fakeCH.getTimeseriesCalled).toBe(true);
      });
    });

    describe("when projection service is not available", () => {
      it("skips feature flag check and falls through to normal routing", async () => {
        const fakeES = createFakeBackend();
        const fakeCH = createFakeBackend({ available: true });
        const fakeProjection = createFakeBackend({ available: false });
        const fakePrisma = createFakePrisma({ clickhouseEnabled: true });
        const fakeFlags = createFakeFeatureFlagService(true);

        const service = new AnalyticsService({
          esService: fakeES,
          chService: fakeCH,
          projectionService: fakeProjection,
          prisma: fakePrisma,
          featureFlagService: fakeFlags,
        });

        const result = await service.getTimeseries(input);

        expect(result.currentPeriod).toHaveLength(1);
        expect(fakeProjection.getTimeseriesCalled).toBe(false);
        expect(fakeCH.getTimeseriesCalled).toBe(true);
        // Should not even call the feature flag service when projection is unavailable
        expect(fakeFlags.isEnabled).not.toHaveBeenCalled();
      });
    });

    describe("when projection service is not provided", () => {
      it("falls through to normal CH/ES routing", async () => {
        const fakeES = createFakeBackend();
        const fakeCH = createFakeBackend({ available: true });
        const fakePrisma = createFakePrisma({ clickhouseEnabled: true });

        const service = new AnalyticsService({
          esService: fakeES,
          chService: fakeCH,
          prisma: fakePrisma,
        });

        const result = await service.getTimeseries(input);

        expect(result.currentPeriod).toHaveLength(1);
        expect(fakeCH.getTimeseriesCalled).toBe(true);
      });
    });

    describe("when comparison mode is enabled with projections", () => {
      it("compares projection results against CH results", async () => {
        const fakeES = createFakeBackend();
        const fakeCH = createFakeBackend({
          available: true,
          timeseriesResult: {
            currentPeriod: [{ date: "2024-01-01", count: 100 }],
            previousPeriod: [{ date: "2023-12-31", count: 90 }],
          },
        });
        const fakeProjection = createFakeBackend({
          available: true,
          timeseriesResult: {
            currentPeriod: [{ date: "2024-01-01", count: 200 }],
            previousPeriod: [{ date: "2023-12-31", count: 180 }],
          },
        });
        const fakePrisma = createFakePrisma({ clickhouseEnabled: true });
        const fakeFlags = createFakeFeatureFlagService(true);
        const fakeComparator = {
          compare: vi.fn(),
        };

        const service = new AnalyticsService({
          esService: fakeES,
          chService: fakeCH,
          projectionService: fakeProjection,
          prisma: fakePrisma,
          featureFlagService: fakeFlags,
          comparator: fakeComparator as any,
          config: { comparisonModeEnabled: true },
        });

        const result = await service.getTimeseries(input);

        // Projection is the primary result
        expect(result.currentPeriod[0]!.count).toBe(200);
        // Both CH and projection were called for comparison
        expect(fakeCH.getTimeseriesCalled).toBe(true);
        expect(fakeProjection.getTimeseriesCalled).toBe(true);
        // ES was not called
        expect(fakeES.getTimeseriesCalled).toBe(false);
        // Comparator was invoked with CH as baseline and projection as experimental
        expect(fakeComparator.compare).toHaveBeenCalledWith(
          "getTimeseries",
          expect.anything(),
          expect.objectContaining({
            currentPeriod: [{ date: "2024-01-01", count: 100 }],
          }),
          expect.objectContaining({
            currentPeriod: [{ date: "2024-01-01", count: 200 }],
          }),
        );
      });
    });

    it("passes correct flag key and projectId to feature flag service", async () => {
      const fakeES = createFakeBackend();
      const fakeCH = createFakeBackend({ available: true });
      const fakeProjection = createFakeBackend({ available: true });
      const fakePrisma = createFakePrisma({ clickhouseEnabled: false });
      const fakeFlags = createFakeFeatureFlagService(false);

      const service = new AnalyticsService({
        esService: fakeES,
        chService: fakeCH,
        projectionService: fakeProjection,
        prisma: fakePrisma,
        featureFlagService: fakeFlags,
      });

      await service.getTimeseries(input);

      expect(fakeFlags.isEnabled).toHaveBeenCalledWith(
        "analytics_projections_enabled",
        "test-project",
        false,
        { projectId: "test-project" },
      );
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
