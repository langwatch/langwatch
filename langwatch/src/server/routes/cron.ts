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
import type { Context } from "hono";
import { env } from "~/env.mjs";
import {
  createServiceApp,
  internalSecret,
} from "~/server/api/security";
import { validateInternalSecret } from "./_lib/internal-secret";
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
import {
  reportHasFailures,
  type SeedRunReport,
} from "../../../scripts/dogfood/governance/_lib/seedRunner";
import { runSeedDemo } from "../../../scripts/dogfood/governance/seed-demo";
import { ANALYTICS_KEYS } from "~/types";
import { createLogger } from "~/utils/logger/server";
import { captureException } from "~/utils/posthogErrorCapture";

const logger = createLogger("langwatch:cron");

const secured = createServiceApp({ basePath: "/api" });

type CronContext = Context;

const cronPolicy = () =>
  internalSecret(
    "cron shared secret validated in-handler via validateInternalSecret",
  );

/** Validates the cron shared secret. See validateInternalSecret (fail-closed + constant-time). */
function validateCronKey(c: CronContext): boolean {
  return validateInternalSecret(c);
}

// ---------- GET|POST /api/cron/old_lambdas_cleanup ----------
const oldLambdasCleanupHandler = async (c: CronContext) => {
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
};
secured.access(cronPolicy()).get("/cron/old_lambdas_cleanup", oldLambdasCleanupHandler);
secured.access(cronPolicy()).post("/cron/old_lambdas_cleanup", oldLambdasCleanupHandler);

// ---------- GET /api/cron/scenario_analytics ----------
secured.access(cronPolicy()).get("/cron/scenario_analytics", async (c) => {
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

// ---------- GET|POST /api/cron/schedule_topic_clustering ----------
const scheduleTopicClusteringHandler = async (c: CronContext) => {
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
};
secured.access(cronPolicy()).get("/cron/schedule_topic_clustering", scheduleTopicClusteringHandler);
secured.access(cronPolicy()).post("/cron/schedule_topic_clustering", scheduleTopicClusteringHandler);

// ---------- GET /api/cron/trace_analytics ----------
secured.access(cronPolicy()).get("/cron/trace_analytics", async (c) => {
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

// ---------- GET|POST /api/cron/traces_retention_period_cleanup ----------
const tracesRetentionPeriodCleanupHandler = async (c: CronContext) => {
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
};
secured.access(cronPolicy()).get("/cron/traces_retention_period_cleanup", tracesRetentionPeriodCleanupHandler);
secured.access(cronPolicy()).post("/cron/traces_retention_period_cleanup", tracesRetentionPeriodCleanupHandler);

// ---------- GET /api/cron/triggers ----------
secured.access(cronPolicy()).get("/cron/triggers", async (c) => {
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

  // Only process custom graph triggers — trace-based triggers are handled
  // reactively by the alertTrigger reactor on the trace-processing pipeline.
  const graphTriggers = triggers.filter((t) => t.customGraphId);

  const results = [];

  for (const trigger of graphTriggers) {
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
  }

  return c.json(results);
});

// ---------- POST /api/cron/seed_demo ----------
//
// Triggers a daily reset of the canonical demo org allowlist. The
// langwatch-saas Kubernetes CronJob curls this route with the
// `CRON_API_KEY` Bearer header. `runSeedDemo` is the same code path the
// dev CLI uses (`scripts/dogfood/governance/seed-demo.ts`), gated by
// the `DEMO_ORG_IDS` allowlist guard so an unset env returns a clean
// 500 instead of touching real customer data.
//
// Returns the SeedRunReport JSON either way; HTTP 500 when any action
// failed so CronJob alerting can fire on the response code.
const seedDemoHandler = async (c: CronContext) => {
  if (!validateCronKey(c)) {
    return c.body(null, 401);
  }
  let report: SeedRunReport;
  try {
    report = await runSeedDemo({ execute: true });
  } catch (error: any) {
    logger.error({ error }, "demo seed run threw before completing");
    return c.json(
      {
        message: "demo seed run threw",
        error: error?.message ? error.message.toString() : `${error}`,
      },
      500,
    );
  }
  const status = reportHasFailures(report) ? 500 : 200;
  return c.json({ report }, status);
};
secured.access(cronPolicy()).get("/cron/seed_demo", seedDemoHandler);
secured.access(cronPolicy()).post("/cron/seed_demo", seedDemoHandler);

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

export const app = secured.hono;
