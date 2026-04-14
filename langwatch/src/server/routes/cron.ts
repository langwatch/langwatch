/**
 * Hono routes for cron jobs.
 *
 * Replaces:
 * - src/pages/api/cron/old_lambdas_cleanup.ts
 * - src/pages/api/cron/scenario_analytics.ts
 * - src/pages/api/cron/schedule_topic_clustering.ts
 * - src/pages/api/cron/trace_analytics.ts
 * - src/pages/api/cron/traces_retention_period_cleanup.ts
 * - src/pages/api/cron/triggers/index.ts
 */
import type { Prisma, Project, Trigger } from "@prisma/client";
import { Hono } from "hono";
import { env } from "~/env.mjs";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { esClient, TRACE_INDEX } from "~/server/elasticsearch";
import { createScenarioAnalyticsQueriesForAllEventTypes } from "~/server/scenario-analytics";
import { deleteTracesRetentionPolicy } from "~/tasks/deleteTracesRetentionPolicy";
import { COLD_STORAGE_AGE_DAYS } from "~/server/elasticsearch";
import { cleanupOrphanedTraces } from "~/tasks/cold/cleanupOrphanedHotTraces";
import { migrateToColdStorage } from "~/tasks/cold/moveTracesToColdStorage";
import { scheduleTopicClustering } from "~/server/background/queues/topicClusteringQueue";
import cleanupOldLambdas from "~/tasks/cleanupOldLambdas";
import { processCustomGraphTrigger } from "~/pages/api/cron/triggers/customGraphTrigger";
import { processTraceBasedTrigger } from "~/pages/api/cron/triggers/traceBasedTrigger";
import { ANALYTICS_KEYS } from "~/types";
import { createLogger } from "~/utils/logger/server";
import { captureException } from "~/utils/posthogErrorCapture";

const logger = createLogger("langwatch:cron");

export const app = new Hono().basePath("/api");

/** Extracts and validates the cron API key from the Authorization header. */
function validateCronKey(c: { req: { header: (name: string) => string | undefined } }): boolean {
  let cronApiKey = c.req.header("authorization");
  cronApiKey = cronApiKey?.startsWith("Bearer ")
    ? cronApiKey.slice(7)
    : cronApiKey;
  return cronApiKey === process.env.CRON_API_KEY;
}

// ---------- GET /api/cron/old_lambdas_cleanup ----------
app.all("/cron/old_lambdas_cleanup", async (c) => {
  if (!validateCronKey(c)) {
    return c.body(null, 401);
  }

  try {
    await cleanupOldLambdas();
    return c.json({ message: "Old lambdas deleted successfully" });
  } catch (error: any) {
    return c.json(
      {
        message: "Error deleting old lambdas",
        error: error?.message ? error.message.toString() : `${error}`,
      },
      500,
    );
  }
});

// ---------- GET /api/cron/scenario_analytics ----------
app.get("/cron/scenario_analytics", async (c) => {
  if (!validateCronKey(c)) {
    return c.body(null, 401);
  }

  try {
    const result = await processScenarioAnalytics();
    return c.json({
      success: true,
      projectsProcessed: result.projectsProcessed,
      analyticsCreated: result.analyticsCreated,
    });
  } catch (error) {
    logger.error({ error }, "[Scenario Analytics] Error");
    return c.json(
      { success: false, error: "Failed to process scenario analytics" },
      500,
    );
  }
});

// ---------- GET /api/cron/schedule_topic_clustering ----------
app.all("/cron/schedule_topic_clustering", async (c) => {
  if (!validateCronKey(c)) {
    return c.body(null, 401);
  }

  try {
    await scheduleTopicClustering();
    return c.json({ message: "Topic clustering scheduled" });
  } catch (error: any) {
    return c.json(
      {
        message: "Error starting worker",
        error: error?.message ? error?.message.toString() : `${error}`,
      },
      500,
    );
  }
});

// ---------- GET /api/cron/trace_analytics ----------
app.get("/cron/trace_analytics", async (c) => {
  if (!validateCronKey(c)) {
    return c.body(null, 401);
  }

  const projects = await prisma.project.findMany({
    select: { id: true },
  });

  const client = await esClient({ test: true });

  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);
  const yesterdayEnd = new Date(yesterday);
  yesterdayEnd.setUTCDate(yesterdayEnd.getUTCDate() + 1);

  const startTimestamp = Date.UTC(
    yesterday.getUTCFullYear(),
    yesterday.getUTCMonth(),
    yesterday.getUTCDate(),
    0, 0, 0, 0,
  );
  const endTimestamp = Date.UTC(
    yesterdayEnd.getUTCFullYear(),
    yesterdayEnd.getUTCMonth(),
    yesterdayEnd.getUTCDate(),
    0, 0, 0, 0,
  );

  const msearchBody = projects.flatMap((project) => [
    { index: TRACE_INDEX.alias },
    {
      size: 1,
      sort: [{ "timestamps.started_at": "desc" }],
      query: {
        bool: {
          must: [
            {
              bool: {
                should: [
                  { term: { "metadata.project_id": project.id } },
                  { term: { project_id: project.id } },
                ],
                minimum_should_match: 1,
              },
            },
            {
              range: {
                "timestamps.started_at": {
                  gte: startTimestamp,
                  lt: endTimestamp,
                },
              },
            },
          ],
        },
      },
    },
  ]);

  try {
    const msearchResult = await client.msearch({ body: msearchBody });

    const analyticsToCreate = msearchResult.responses
      .map((response: any, index: number) => {
        const traceCount = response?.hits?.total?.value ?? 0;
        if (traceCount === 0) return null;
        return {
          projectId: projects[index]?.id,
          key: ANALYTICS_KEYS.PROJECT_TRACE_COUNT_PER_DAY,
          numericValue: traceCount,
          createdAt: yesterday,
        } as Prisma.AnalyticsCreateManyInput;
      })
      .filter(
        (entry): entry is Prisma.AnalyticsCreateManyInput => entry !== null,
      );

    if (analyticsToCreate.length > 0) {
      const existingEntries = await prisma.analytics.findMany({
        where: {
          projectId: {
            in: analyticsToCreate.map((entry) => entry.projectId),
          },
          key: ANALYTICS_KEYS.PROJECT_TRACE_COUNT_PER_DAY,
          createdAt: { gte: yesterday, lt: yesterdayEnd },
        },
      });

      const newAnalyticsToCreate = analyticsToCreate.filter(
        (entry) =>
          !existingEntries.some(
            (existing) => existing.projectId === entry.projectId,
          ),
      );

      if (newAnalyticsToCreate.length > 0) {
        await prisma.analytics.createMany({
          data: newAnalyticsToCreate,
          skipDuplicates: true,
        });
        logger.info(
          {
            count: newAnalyticsToCreate.length,
            date: yesterday.toISOString().split("T")[0],
          },
          "created trace analytics entries",
        );
      } else {
        logger.info(
          { date: yesterday.toISOString().split("T")[0] },
          "all trace analytics entries already exist",
        );
      }
    } else {
      logger.info(
        { date: yesterday.toISOString().split("T")[0] },
        "no traces found for date",
      );
    }
  } catch (error) {
    logger.error({ error }, "trace analytics error");
  }

  // Check usage limits for all organizations (SaaS only)
  if (env.IS_SAAS) {
    try {
      const organizations = await prisma.organization.findMany({
        select: { id: true },
      });

      const usageService = getApp().usage;

      for (const org of organizations) {
        try {
          const projectIds = await getApp().organizations.getProjectIds(
            org.id,
          );
          if (projectIds.length === 0) {
            logger.debug(
              { organizationId: org.id },
              "organization has no projects, skipping",
            );
            continue;
          }
          const currentMonthCount =
            await usageService.getCurrentMonthCount({
              organizationId: org.id,
            });

          if (currentMonthCount === "unlimited") {
            logger.debug(
              { organizationId: org.id },
              "organization has unlimited plan, skipping usage check",
            );
            continue;
          }

          const activePlan = await getApp().planProvider.getActivePlan({
            organizationId: org.id,
          });

          if (
            !activePlan ||
            typeof activePlan.maxMessagesPerMonth !== "number" ||
            activePlan.maxMessagesPerMonth <= 0
          ) {
            logger.debug(
              { organizationId: org.id },
              "organization has invalid or missing plan configuration, skipping",
            );
            continue;
          }

          const maxMessagesPerMonth = activePlan.maxMessagesPerMonth;
          const usagePercentage =
            maxMessagesPerMonth > 0
              ? (currentMonthCount / maxMessagesPerMonth) * 100
              : 0;

          if (currentMonthCount > 1) {
            logger.info(
              {
                organizationId: org.id,
                currentMonthMessagesCount: currentMonthCount,
                maxMessagesPerMonth,
                usagePercentage: Number(usagePercentage.toFixed(1)),
                projectCount: projectIds.length,
              },
              "organization usage stats",
            );
          }

          await getApp().usageLimits.checkAndSendWarning({
            organizationId: org.id,
            currentMonthMessagesCount: currentMonthCount,
            maxMonthlyUsageLimit: maxMessagesPerMonth,
          });
        } catch (error) {
          logger.error(
            { organizationId: org.id, error },
            "error checking usage limits for organization",
          );
          captureException(error, {
            extra: { organizationId: org.id },
          });
        }
      }
    } catch (error) {
      logger.error({ error }, "error checking usage limits");
      captureException(error);
    }
  } else {
    logger.debug("skipping usage limit notifications (not SaaS)");
  }

  return c.json({ success: true });
});

// ---------- GET /api/cron/traces_retention_period_cleanup ----------
app.all("/cron/traces_retention_period_cleanup", async (c) => {
  if (!validateCronKey(c)) {
    return c.body(null, 401);
  }

  try {
    const projectId = c.req.query("projectId") as string | undefined;
    const organizationId = projectId
      ? (
          await prisma.project.findUnique({
            where: { id: projectId },
            select: { team: { select: { organizationId: true } } },
          })
        )?.team?.organizationId
      : undefined;
    const cleanedUpOrphanedTraces = await cleanupOrphanedTraces(
      COLD_STORAGE_AGE_DAYS,
      organizationId,
    );
    const movedToColdStorage = await migrateToColdStorage(
      COLD_STORAGE_AGE_DAYS,
      organizationId,
    );
    const totalDeleted = await deleteTracesRetentionPolicy(projectId);

    return c.json({
      message:
        "Traces retention period maintenance completed successfully",
      totalDeleted,
      movedToColdStorage: movedToColdStorage?.migrated,
      cleanedUpOrphanedTraces: cleanedUpOrphanedTraces?.deleted,
    });
  } catch (error: any) {
    return c.json(
      {
        message: "Error deleting old traces",
        error: error?.message ? error.message.toString() : `${error}`,
      },
      500,
    );
  }
});

// ---------- GET /api/cron/triggers ----------
app.get("/cron/triggers", async (c) => {
  if (!validateCronKey(c)) {
    return c.body(null, 401);
  }

  let triggers: Trigger[];
  let projects: Project[];

  try {
    projects = await prisma.project.findMany({
      where: { firstMessage: true, archivedAt: null },
    });

    triggers = await prisma.trigger.findMany({
      where: {
        active: true,
        projectId: { in: projects.map((project) => project.id) },
      },
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to fetch triggers",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }

  const results = [];

  for (const trigger of triggers) {
    if (trigger.customGraphId) {
      try {
        const result = await processCustomGraphTrigger(trigger, projects);
        results.push(result);
      } catch (error) {
        logger.error(
          { triggerId: trigger.id, error },
          "error processing custom graph trigger",
        );
        results.push({
          triggerId: trigger.id,
          status: "error",
          message:
            error instanceof Error ? error.message : "Unknown error",
          type: "customGraph",
        });
      }
    } else {
      try {
        const result = await processTraceBasedTrigger(trigger, projects);
        results.push(result);
      } catch (error) {
        logger.error(
          { triggerId: trigger.id, error },
          "error processing trace-based trigger",
        );
        results.push({
          triggerId: trigger.id,
          status: "error",
          message:
            error instanceof Error ? error.message : "Unknown error",
          type: "traceBased",
        });
      }
    }
  }

  return c.json(results);
});

// --- Scenario analytics helper functions ---

function getYesterdayDateRange() {
  const yesterdayStart = new Date();
  yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);
  yesterdayStart.setUTCHours(0, 0, 0, 0);
  const yesterdayEnd = new Date(yesterdayStart);
  yesterdayEnd.setUTCDate(yesterdayEnd.getUTCDate() + 1);
  return { yesterdayStart, yesterdayEnd };
}

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

async function processScenarioAnalytics() {
  const projects = await prisma.project.findMany({
    select: { id: true },
  });
  const client = await esClient({ test: true });
  const dateRange = getYesterdayDateRange();

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
    }),
  );

  const msearchResult = await client.msearch({ body: msearchBody });

  const analyticsToCreate: Prisma.AnalyticsCreateManyInput[] = [];

  for (let i = 0; i < projects.length; i++) {
    const project = projects[i];
    if (!project) continue;
    const baseIndex = i * 3;

    const messageSnapshotCount = getHitCount(msearchResult, baseIndex);
    const runStartedCount = getHitCount(msearchResult, baseIndex + 1);
    const runFinishedCount = getHitCount(msearchResult, baseIndex + 2);
    const totalCount =
      messageSnapshotCount + runStartedCount + runFinishedCount;

    if (messageSnapshotCount > 0) {
      analyticsToCreate.push({
        projectId: project.id,
        key: ANALYTICS_KEYS.SCENARIO_MESSAGE_SNAPSHOT_COUNT_PER_DAY,
        numericValue: messageSnapshotCount,
        createdAt: dateRange.yesterdayStart,
      });
    }
    if (runStartedCount > 0) {
      analyticsToCreate.push({
        projectId: project.id,
        key: ANALYTICS_KEYS.SCENARIO_RUN_STARTED_COUNT_PER_DAY,
        numericValue: runStartedCount,
        createdAt: dateRange.yesterdayStart,
      });
    }
    if (runFinishedCount > 0) {
      analyticsToCreate.push({
        projectId: project.id,
        key: ANALYTICS_KEYS.SCENARIO_RUN_FINISHED_COUNT_PER_DAY,
        numericValue: runFinishedCount,
        createdAt: dateRange.yesterdayStart,
      });
    }
    if (totalCount > 0) {
      analyticsToCreate.push({
        projectId: project.id,
        key: ANALYTICS_KEYS.SCENARIO_EVENT_COUNT_PER_DAY,
        numericValue: totalCount,
        createdAt: dateRange.yesterdayStart,
      });
    }
  }

  if (analyticsToCreate.length > 0) {
    const existingEntries = await prisma.analytics.findMany({
      where: {
        projectId: {
          in: analyticsToCreate.map((entry) => entry.projectId),
        },
        key: {
          in: [
            ANALYTICS_KEYS.SCENARIO_EVENT_COUNT_PER_DAY,
            ANALYTICS_KEYS.SCENARIO_MESSAGE_SNAPSHOT_COUNT_PER_DAY,
            ANALYTICS_KEYS.SCENARIO_RUN_STARTED_COUNT_PER_DAY,
            ANALYTICS_KEYS.SCENARIO_RUN_FINISHED_COUNT_PER_DAY,
          ],
        },
        createdAt: {
          gte: dateRange.yesterdayStart,
          lt: dateRange.yesterdayEnd,
        },
      },
    });

    const newAnalyticsToCreate = analyticsToCreate.filter(
      (entry) =>
        !existingEntries.some(
          (existing) =>
            existing.projectId === entry.projectId &&
            existing.key === entry.key,
        ),
    );

    if (newAnalyticsToCreate.length > 0) {
      await prisma.analytics.createMany({
        data: newAnalyticsToCreate,
        skipDuplicates: true,
      });
      logger.info(
        {
          count: newAnalyticsToCreate.length,
          date: dateRange.yesterdayStart.toISOString().split("T")[0],
        },
        "created scenario analytics entries",
      );
    } else {
      logger.info(
        {
          date: dateRange.yesterdayStart.toISOString().split("T")[0],
        },
        "all scenario analytics entries already exist",
      );
    }
  } else {
    logger.info(
      { date: dateRange.yesterdayStart.toISOString().split("T")[0] },
      "no scenario events found",
    );
  }

  return {
    projectsProcessed: projects.length,
    analyticsCreated: analyticsToCreate.length,
  };
}
