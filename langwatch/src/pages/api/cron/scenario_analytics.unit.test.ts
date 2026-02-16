import type { NextApiRequest, NextApiResponse } from "next";
import { createMocks } from "node-mocks-http";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "~/server/db";
import { ANALYTICS_KEYS } from "~/types";
import handler from "./scenario_analytics";

// Mock dependencies
vi.mock("~/server/db", () => ({
  prisma: {
    project: {
      findMany: vi.fn(),
    },
    analytics: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
  },
}));

vi.mock("~/server/elasticsearch", () => ({
  esClient: vi.fn(),
}));

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock("~/server/scenario-analytics", () => ({
  createScenarioAnalyticsQueriesForAllEventTypes: vi.fn(),
}));

// Set up test environment variables
beforeAll(() => {
  process.env.CRON_API_KEY = "test-cron-api-key";
});

describe("handler()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getYesterdayDateRange", () => {
    it("calculates yesterday's date range correctly", async () => {
      // Mock the current date to a known value for testing
      const mockDate = new Date("2024-01-15T12:00:00Z");
      vi.useFakeTimers();
      vi.setSystemTime(mockDate);

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "GET",
        headers: {
          authorization: `Bearer ${process.env.CRON_API_KEY}`,
        },
      });

      // Mock successful responses
      const mockProjects = [{ id: "test-project-1" }];
      const mockEsClient = {
        msearch: vi.fn().mockResolvedValue({
          responses: [
            { hits: { total: { value: 5 } } },
            { hits: { total: { value: 2 } } },
            { hits: { total: { value: 1 } } },
            { hits: { total: { value: 1 } } },
          ],
        }),
      };

      (prisma.project.findMany as any).mockResolvedValue(mockProjects);
      (prisma.analytics.findMany as any).mockResolvedValue([]);
      (prisma.analytics.createMany as any).mockResolvedValue({ count: 4 });

      const { esClient } = await import("~/server/elasticsearch");
      (esClient as any).mockResolvedValue(mockEsClient);

      const { createScenarioAnalyticsQueriesForAllEventTypes } =
        await import("~/server/scenario-analytics");
      (createScenarioAnalyticsQueriesForAllEventTypes as any).mockReturnValue([
        { index: "test-index" },
        { query: { test: "query" } },
        { index: "test-index" },
        { query: { test: "query" } },
        { index: "test-index" },
        { query: { test: "query" } },
      ]);

      await handler(req, res);

      expect(res.statusCode).toBe(200);

      // Verify the date range was calculated correctly
      // Yesterday should be 2024-01-14 00:00:00 UTC to 2024-01-15 00:00:00 UTC
      const expectedStart = new Date("2024-01-14T00:00:00.000Z");
      const expectedEnd = new Date("2024-01-15T00:00:00.000Z");

      expect(
        createScenarioAnalyticsQueriesForAllEventTypes,
      ).toHaveBeenCalledWith({
        projectId: "test-project-1",
        startTime: expectedStart.getTime(),
        endTime: expectedEnd.getTime(),
        includeDateHistogram: true,
        dateHistogramOptions: {
          calendarInterval: "day",
          format: "yyyy-MM-dd",
          timeZone: "UTC",
        },
      });

      vi.useRealTimers();
    });
  });

  describe("getHitCount", () => {
    it("extracts hit count from Elasticsearch response", async () => {
      const mockProjects = [{ id: "test-project-1" }];
      const mockEsClient = {
        msearch: vi.fn().mockResolvedValue({
          responses: [
            { hits: { total: { value: 5 } } },
            { hits: { total: { value: 2 } } },
            { hits: { total: { value: 1 } } },
            { hits: { total: { value: 1 } } },
          ],
        }),
      };

      (prisma.project.findMany as any).mockResolvedValue(mockProjects);
      (prisma.analytics.findMany as any).mockResolvedValue([]);
      (prisma.analytics.createMany as any).mockResolvedValue({ count: 4 });

      const { esClient } = await import("~/server/elasticsearch");
      (esClient as any).mockResolvedValue(mockEsClient);

      const { createScenarioAnalyticsQueriesForAllEventTypes } =
        await import("~/server/scenario-analytics");
      (createScenarioAnalyticsQueriesForAllEventTypes as any).mockReturnValue([
        { index: "test-index" },
        { query: { test: "query" } },
        { index: "test-index" },
        { query: { test: "query" } },
        { index: "test-index" },
        { query: { test: "query" } },
      ]);

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "GET",
        headers: {
          authorization: `Bearer ${process.env.CRON_API_KEY}`,
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      const responseData = res._getJSONData();
      expect(responseData.analyticsCreated).toBe(4); // All 4 event types should be created
    });

    it("handles missing hits in response", async () => {
      const mockProjects = [{ id: "test-project-1" }];
      const mockEsClient = {
        msearch: vi.fn().mockResolvedValue({
          responses: [
            { hits: { total: { value: 0 } } },
            { hits: { total: { value: 0 } } },
            { hits: { total: { value: 0 } } },
            { hits: { total: { value: 0 } } },
          ],
        }),
      };

      (prisma.project.findMany as any).mockResolvedValue(mockProjects);
      (prisma.analytics.findMany as any).mockResolvedValue([]);
      (prisma.analytics.createMany as any).mockResolvedValue({ count: 0 });

      const { esClient } = await import("~/server/elasticsearch");
      (esClient as any).mockResolvedValue(mockEsClient);

      const { createScenarioAnalyticsQueriesForAllEventTypes } =
        await import("~/server/scenario-analytics");
      (createScenarioAnalyticsQueriesForAllEventTypes as any).mockReturnValue([
        { index: "test-index" },
        { query: { test: "query" } },
        { index: "test-index" },
        { query: { test: "query" } },
        { index: "test-index" },
        { query: { test: "query" } },
      ]);

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "GET",
        headers: {
          authorization: `Bearer ${process.env.CRON_API_KEY}`,
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      const responseData = res._getJSONData();
      expect(responseData.analyticsCreated).toBe(0); // No analytics should be created
    });
  });

  describe("filterExistingAnalytics", () => {
    it("filters out existing analytics", async () => {
      const mockProjects = [{ id: "test-project-1" }];
      const mockEsClient = {
        msearch: vi.fn().mockResolvedValue({
          responses: [
            { hits: { total: { value: 5 } } },
            { hits: { total: { value: 2 } } },
            { hits: { total: { value: 1 } } },
            { hits: { total: { value: 1 } } },
          ],
        }),
      };

      // Mock existing analytics for yesterday
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      yesterday.setUTCHours(0, 0, 0, 0);

      const existingAnalytics = [
        {
          projectId: "test-project-1",
          key: ANALYTICS_KEYS.SCENARIO_EVENT_COUNT_PER_DAY,
          createdAt: yesterday,
        },
        {
          projectId: "test-project-1",
          key: ANALYTICS_KEYS.SCENARIO_MESSAGE_SNAPSHOT_COUNT_PER_DAY,
          createdAt: yesterday,
        },
      ];

      (prisma.project.findMany as any).mockResolvedValue(mockProjects);
      (prisma.analytics.findMany as any).mockResolvedValue(existingAnalytics);
      (prisma.analytics.createMany as any).mockResolvedValue({ count: 2 });

      const { esClient } = await import("~/server/elasticsearch");
      (esClient as any).mockResolvedValue(mockEsClient);

      const { createScenarioAnalyticsQueriesForAllEventTypes } =
        await import("~/server/scenario-analytics");
      (createScenarioAnalyticsQueriesForAllEventTypes as any).mockReturnValue([
        { index: "test-index" },
        { query: { test: "query" } },
        { index: "test-index" },
        { query: { test: "query" } },
        { index: "test-index" },
        { query: { test: "query" } },
      ]);

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "GET",
        headers: {
          authorization: `Bearer ${process.env.CRON_API_KEY}`,
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      const responseData = res._getJSONData();
      expect(responseData.analyticsCreated).toBe(4); // All 4 analytics should be created initially

      // Verify createMany was called with the correct filtered data
      const createManySpy = vi.mocked(prisma.analytics.createMany);
      expect(createManySpy).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            projectId: "test-project-1",
            key: ANALYTICS_KEYS.SCENARIO_RUN_STARTED_COUNT_PER_DAY,
          }),
          expect.objectContaining({
            projectId: "test-project-1",
            key: ANALYTICS_KEYS.SCENARIO_RUN_FINISHED_COUNT_PER_DAY,
          }),
        ]),
        skipDuplicates: true,
      });
    });
  });

  describe("Error Handling", () => {
    it("handles database errors", async () => {
      (prisma.project.findMany as any).mockRejectedValue(
        new Error("Database connection failed"),
      );

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "GET",
        headers: {
          authorization: `Bearer ${process.env.CRON_API_KEY}`,
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(500);
      const responseData = res._getJSONData();
      expect(responseData.success).toBe(false);
      expect(responseData.error).toBe("Failed to process scenario analytics");
    });

    it("handles Elasticsearch errors", async () => {
      const mockProjects = [{ id: "test-project-1" }];
      const mockEsClient = {
        msearch: vi
          .fn()
          .mockRejectedValue(new Error("Elasticsearch connection failed")),
      };

      (prisma.project.findMany as any).mockResolvedValue(mockProjects);

      const { esClient } = await import("~/server/elasticsearch");
      (esClient as any).mockResolvedValue(mockEsClient);

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "GET",
        headers: {
          authorization: `Bearer ${process.env.CRON_API_KEY}`,
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(500);
      const responseData = res._getJSONData();
      expect(responseData.success).toBe(false);
      expect(responseData.error).toBe("Failed to process scenario analytics");
    });

    it("handles analytics creation errors", async () => {
      const mockProjects = [{ id: "test-project-1" }];
      const mockEsClient = {
        msearch: vi.fn().mockResolvedValue({
          responses: [
            { hits: { total: { value: 5 } } },
            { hits: { total: { value: 2 } } },
            { hits: { total: { value: 1 } } },
            { hits: { total: { value: 1 } } },
          ],
        }),
      };

      (prisma.project.findMany as any).mockResolvedValue(mockProjects);
      (prisma.analytics.findMany as any).mockResolvedValue([]);
      (prisma.analytics.createMany as any).mockRejectedValue(
        new Error("Analytics creation failed"),
      );

      const { esClient } = await import("~/server/elasticsearch");
      (esClient as any).mockResolvedValue(mockEsClient);

      const { createScenarioAnalyticsQueriesForAllEventTypes } =
        await import("~/server/scenario-analytics");
      (createScenarioAnalyticsQueriesForAllEventTypes as any).mockReturnValue([
        { index: "test-index" },
        { query: { test: "query" } },
        { index: "test-index" },
        { query: { test: "query" } },
        { index: "test-index" },
        { query: { test: "query" } },
      ]);

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "GET",
        headers: {
          authorization: `Bearer ${process.env.CRON_API_KEY}`,
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(500);
      const responseData = res._getJSONData();
      expect(responseData.success).toBe(false);
      expect(responseData.error).toBe("Failed to process scenario analytics");
    });
  });

  describe("Multiple Projects", () => {
    it("processes multiple projects correctly", async () => {
      const mockProjects = [{ id: "test-project-1" }, { id: "test-project-2" }];

      const mockEsClient = {
        msearch: vi.fn().mockResolvedValue({
          responses: [
            // Project 1 responses (3 queries per project)
            { hits: { total: { value: 5 } } }, // message snapshot
            { hits: { total: { value: 2 } } }, // run started
            { hits: { total: { value: 1 } } }, // run finished
            // Project 2 responses (3 queries per project)
            { hits: { total: { value: 3 } } }, // message snapshot
            { hits: { total: { value: 1 } } }, // run started
            { hits: { total: { value: 0 } } }, // run finished
          ],
        }),
      };

      (prisma.project.findMany as any).mockResolvedValue(mockProjects);
      (prisma.analytics.findMany as any).mockResolvedValue([]);
      (prisma.analytics.createMany as any).mockResolvedValue({ count: 7 });

      const { esClient } = await import("~/server/elasticsearch");
      (esClient as any).mockResolvedValue(mockEsClient);

      const { createScenarioAnalyticsQueriesForAllEventTypes } =
        await import("~/server/scenario-analytics");
      (createScenarioAnalyticsQueriesForAllEventTypes as any).mockReturnValue([
        // Project 1 queries (6 objects: 3 event types × 2 objects each)
        { index: "test-index" },
        { query: { test: "query" } },
        { index: "test-index" },
        { query: { test: "query" } },
        { index: "test-index" },
        { query: { test: "query" } },
        // Project 2 queries (6 objects: 3 event types × 2 objects each)
        { index: "test-index" },
        { query: { test: "query" } },
        { index: "test-index" },
        { query: { test: "query" } },
        { index: "test-index" },
        { query: { test: "query" } },
      ]);

      const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
        method: "GET",
        headers: {
          authorization: `Bearer ${process.env.CRON_API_KEY}`,
        },
      });

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      const responseData = res._getJSONData();
      expect(responseData.projectsProcessed).toBe(2);
      expect(responseData.analyticsCreated).toBe(7); // 4 for project 1 + 3 for project 2

      // Verify createMany was called with analytics for both projects
      const createManySpy = vi.mocked(prisma.analytics.createMany);
      expect(createManySpy).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ projectId: "test-project-1" }),
          expect.objectContaining({ projectId: "test-project-2" }),
        ]),
        skipDuplicates: true,
      });
    });
  });
});
