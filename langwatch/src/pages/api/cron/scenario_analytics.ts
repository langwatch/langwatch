import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "~/server/db";
import { esClient } from "~/server/elasticsearch";
import { type Prisma } from "@prisma/client";
import { ANALYTICS_KEYS } from "~/types";
import { createScenarioAnalyticsQueriesForAllEventTypes } from "~/server/scenario-analytics";
import { createLogger } from "~/utils/logger";

const logger = createLogger("langwatch:cron:scenario-analytics");

interface DateRange {
  yesterdayStart: Date;
  yesterdayEnd: Date;
}

interface AnalyticsResult {
  projectsProcessed: number;
  analyticsCreated: number;
}

/**
 * Validates the HTTP method and API key for the cron job
 */
function validateRequest(req: NextApiRequest): boolean {
  if (req.method !== "GET") {
    return false;
  }

  let cronApiKey = req.headers.authorization;
  cronApiKey = cronApiKey?.startsWith("Bearer ")
    ? cronApiKey.slice(7)
    : cronApiKey;

  return cronApiKey === process.env.CRON_API_KEY;
}

/**
 * Calculates yesterday's date range in UTC
 */
function getYesterdayDateRange(): DateRange {
  const yesterdayStart = new Date();
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);
  yesterdayStart.setUTCHours(0, 0, 0, 0);

  const yesterdayEnd = new Date(yesterdayStart);
  yesterdayEnd.setUTCDate(yesterdayEnd.getUTCDate() + 1);

  return {
    yesterdayStart,
    yesterdayEnd,
  };
}

/**
 * Fetches all project IDs from the database
 */
async function getAllProjectIds(): Promise<{ id: string }[]> {
  try {
    const projects = await prisma.project.findMany({
      select: {
        id: true,
      },
    });
    return projects;
  } catch (error) {
    logger.error("[Scenario Analytics] getAllProjectIds error:", error);
    throw error;
  }
}

/**
 * Safely extracts hit count from Elasticsearch response
 */
function getHitCount(msearchResult: any, index: number): number {
  const response = msearchResult.responses[index];
  if (
    response &&
    "hits" in response &&
    response.hits &&
    "total" in response.hits
  ) {
    return typeof response.hits.total === "object" &&
      "value" in response.hits.total
      ? response.hits.total.value
      : 0;
  }
  return 0;
}

/**
 * Creates analytics entries for a single project based on Elasticsearch results
 */
function createAnalyticsEntriesForProject(
  project: { id: string },
  msearchResult: any,
  baseIndex: number,
  yesterday: Date
): Prisma.AnalyticsCreateManyInput[] {
  const analytics: Prisma.AnalyticsCreateManyInput[] = [];

  // Get counts for individual event types
  const messageSnapshotCount = getHitCount(msearchResult, baseIndex);
  const runStartedCount = getHitCount(msearchResult, baseIndex + 1);
  const runFinishedCount = getHitCount(msearchResult, baseIndex + 2);

  // Calculate total count
  const totalCount = messageSnapshotCount + runStartedCount + runFinishedCount;

  // Add analytics entries for each event type that has a count > 0
  if (messageSnapshotCount > 0) {
    analytics.push({
      projectId: project.id,
      key: ANALYTICS_KEYS.SCENARIO_MESSAGE_SNAPSHOT_COUNT_PER_DAY,
      numericValue: messageSnapshotCount,
      createdAt: yesterday,
    });
  }

  if (runStartedCount > 0) {
    analytics.push({
      projectId: project.id,
      key: ANALYTICS_KEYS.SCENARIO_RUN_STARTED_COUNT_PER_DAY,
      numericValue: runStartedCount,
      createdAt: yesterday,
    });
  }

  if (runFinishedCount > 0) {
    analytics.push({
      projectId: project.id,
      key: ANALYTICS_KEYS.SCENARIO_RUN_FINISHED_COUNT_PER_DAY,
      numericValue: runFinishedCount,
      createdAt: yesterday,
    });
  }

  // Add total count if there are any events
  if (totalCount > 0) {
    analytics.push({
      projectId: project.id,
      key: ANALYTICS_KEYS.SCENARIO_EVENT_COUNT_PER_DAY,
      numericValue: totalCount,
      createdAt: yesterday,
    });
  }

  return analytics;
}

/**
 * Processes Elasticsearch results and creates analytics entries for all projects
 */
function processElasticsearchResults(
  projects: { id: string }[],
  msearchResult: any,
  yesterday: Date
): Prisma.AnalyticsCreateManyInput[] {
  const analyticsToCreate: Prisma.AnalyticsCreateManyInput[] = [];

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    if (!project) continue;

    const baseIndex = i * 3; // 3 queries per project (MESSAGE_SNAPSHOT, RUN_STARTED, RUN_FINISHED)
    const projectAnalytics = createAnalyticsEntriesForProject(
      project,
      msearchResult,
      baseIndex,
      yesterday
    );
    analyticsToCreate.push(...projectAnalytics);
  }

  return analyticsToCreate;
}

/**
 * Filters out analytics entries that already exist in the database
 */
async function filterExistingAnalytics(
  analyticsToCreate: Prisma.AnalyticsCreateManyInput[],
  yesterday: Date,
  yesterdayEnd: Date
): Promise<Prisma.AnalyticsCreateManyInput[]> {
  // If no analytics to create, return empty array
  if (analyticsToCreate.length === 0) {
    return [];
  }

  const existingEntries = await prisma.analytics.findMany({
    where: {
      projectId: { in: analyticsToCreate.map((entry) => entry.projectId) },
      key: {
        in: [
          ANALYTICS_KEYS.SCENARIO_EVENT_COUNT_PER_DAY,
          ANALYTICS_KEYS.SCENARIO_MESSAGE_SNAPSHOT_COUNT_PER_DAY,
          ANALYTICS_KEYS.SCENARIO_RUN_STARTED_COUNT_PER_DAY,
          ANALYTICS_KEYS.SCENARIO_RUN_FINISHED_COUNT_PER_DAY,
        ],
      },
      createdAt: {
        gte: yesterday,
        lt: yesterdayEnd,
      },
    },
  });

  return analyticsToCreate.filter(
    (entry) =>
      !existingEntries.some(
        (existing) =>
          existing.projectId === entry.projectId && existing.key === entry.key
      )
  );
}

/**
 * Saves analytics entries to the database and logs the results
 */
async function saveAnalyticsAndLog(
  newAnalyticsToCreate: Prisma.AnalyticsCreateManyInput[],
  yesterday: Date
): Promise<void> {
  if (newAnalyticsToCreate.length > 0) {
    await prisma.analytics.createMany({
      data: newAnalyticsToCreate,
      skipDuplicates: true,
    });

    const analyticsByType = newAnalyticsToCreate.reduce(
      (acc, entry) => {
        acc[entry.key] = (acc[entry.key] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    logger.info(
      `[Scenario Analytics] Created ${
        newAnalyticsToCreate.length
      } entries for ${yesterday.toISOString().split("T")[0]}:`,
      analyticsByType
    );
  } else {
    logger.info(
      `[Scenario Analytics] All entries exist for ${
        yesterday.toISOString().split("T")[0]
      }`
    );
  }
}

/**
 * Main function to process scenario analytics for all projects
 */
async function processScenarioAnalytics(): Promise<AnalyticsResult> {
  const projects = await getAllProjectIds();
  const client = await esClient({ test: true });
  const dateRange = getYesterdayDateRange();

  // Create queries for all event types for all projects
  const msearchBody = projects.flatMap((project) =>
    createScenarioAnalyticsQueriesForAllEventTypes({
      projectId: project.id,
      startTime: dateRange.yesterdayStart.getTime(),
      endTime: dateRange.yesterdayEnd.getTime(),
      includeDateHistogram: true,
      dateHistogramOptions: {
        calendarInterval: "day",
        format: "yyyy-MM-dd",
        timeZone: "UTC",
      },
    })
  );

  // Execute multi-search to get counts for all projects and event types
  const msearchResult = await client.msearch({
    body: msearchBody,
  });

  // Process results and create analytics entries
  const analyticsToCreate = processElasticsearchResults(
    projects,
    msearchResult,
    dateRange.yesterdayStart
  );

  if (analyticsToCreate.length > 0) {
    const newAnalyticsToCreate = await filterExistingAnalytics(
      analyticsToCreate,
      dateRange.yesterdayStart,
      dateRange.yesterdayEnd
    );

    await saveAnalyticsAndLog(newAnalyticsToCreate, dateRange.yesterdayStart);
  } else {
    logger.info(
      `[Scenario Analytics] No scenario events found for ${
        dateRange.yesterdayStart.toISOString().split("T")[0]
      }`
    );
  }

  return {
    projectsProcessed: projects.length,
    analyticsCreated: analyticsToCreate.length,
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (!validateRequest(req)) {
    return res.status(req.method !== "GET" ? 405 : 401).end();
  }

  try {
    const result = await processScenarioAnalytics();

    return res.status(200).json({
      success: true,
      projectsProcessed: result.projectsProcessed,
      analyticsCreated: result.analyticsCreated,
    });
  } catch (error) {
    logger.error("[Scenario Analytics] Error:", error);
    return res
      .status(500)
      .json({ success: false, error: "Failed to process scenario analytics" });
  }
}
