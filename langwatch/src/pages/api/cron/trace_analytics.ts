import type { Prisma } from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";
import { env } from "~/env.mjs";
import { prisma } from "~/server/db";
import { SubscriptionHandler } from "~/server/subscriptionHandler";
import { esClient, TRACE_INDEX } from "~/server/elasticsearch";
import { UsageLimitService } from "~/server/notifications/usage-limit.service";
import { getApp } from "~/server/app-layer/app";
import { ANALYTICS_KEYS } from "~/types";
import { createLogger } from "~/utils/logger/server";
import { captureException } from "~/utils/posthogErrorCapture";

const logger = createLogger("langwatch:cron:trace-analytics");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).end();
  }

  let cronApiKey = req.headers.authorization;
  cronApiKey = cronApiKey?.startsWith("Bearer ")
    ? cronApiKey.slice(7)
    : cronApiKey;

  if (cronApiKey !== process.env.CRON_API_KEY) {
    return res.status(401).end();
  }

  // Get all projects
  const projects = await prisma.project.findMany({
    select: {
      id: true,
    },
  });

  const client = await esClient({ test: true });

  // Calculate yesterday's date range
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);
  const yesterdayEnd = new Date(yesterday);
  yesterdayEnd.setUTCDate(yesterdayEnd.getUTCDate() + 1);

  // Ensure we're using UTC timestamps
  const startTimestamp = Date.UTC(
    yesterday.getUTCFullYear(),
    yesterday.getUTCMonth(),
    yesterday.getUTCDate(),
    0,
    0,
    0,
    0,
  );
  const endTimestamp = Date.UTC(
    yesterdayEnd.getUTCFullYear(),
    yesterdayEnd.getUTCMonth(),
    yesterdayEnd.getUTCDate(),
    0,
    0,
    0,
    0,
  );

  // Create a multi-search query for all projects
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
    // Execute multi-search to get counts for all projects in one request
    const msearchResult = await client.msearch({
      body: msearchBody,
    });

    // Prepare analytics entries to create
    const analyticsToCreate = msearchResult.responses
      .map((response: any, index: number) => {
        const traceCount = response?.hits?.total?.value ?? 0;
        if (traceCount === 0) {
          return null;
        }
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
      // Check for existing entries
      const existingEntries = await prisma.analytics.findMany({
        where: {
          projectId: { in: analyticsToCreate.map((entry) => entry.projectId) },
          key: ANALYTICS_KEYS.PROJECT_TRACE_COUNT_PER_DAY,
          createdAt: {
            gte: yesterday,
            lt: yesterdayEnd,
          },
        },
      });

      // Filter out projects that already have entries
      const newAnalyticsToCreate = analyticsToCreate.filter(
        (entry) =>
          !existingEntries.some(
            (existing) => existing.projectId === entry.projectId,
          ),
      );

      if (newAnalyticsToCreate.length > 0) {
        // Batch create only new analytics entries
        await prisma.analytics.createMany({
          data: newAnalyticsToCreate,
          skipDuplicates: true,
        });
        logger.info(
          { count: newAnalyticsToCreate.length, date: yesterday.toISOString().split("T")[0] },
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

  // Check usage limits for all organizations and send notifications if needed
  // Only run in SaaS environment
  if (env.IS_SAAS) {
    try {
      const organizations = await prisma.organization.findMany({
        select: {
          id: true,
        },
      });

      const usageService = getApp().usage;

      for (const org of organizations) {
        try {
          const projectIds = await getApp().organizations.getProjectIds(org.id);
          if (projectIds.length === 0) {
            logger.debug(
              { organizationId: org.id },
              "organization has no projects, skipping",
            );
            continue;
          }
          const currentMonthMessagesCount =
            await usageService.getCurrentMonthCount({
              organizationId: org.id,
            });
          const activePlan =
            await SubscriptionHandler.getActivePlan(org.id);

          // Guard against null/undefined activePlan or invalid maxMessagesPerMonth
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
              ? (currentMonthMessagesCount / maxMessagesPerMonth) * 100
              : 0;

          if (currentMonthMessagesCount > 1) {
            logger.info(
              {
                organizationId: org.id,
                currentMonthMessagesCount,
                maxMessagesPerMonth,
                usagePercentage: Number(usagePercentage.toFixed(1)),
                projectCount: projectIds.length,
              },
              "organization usage stats",
            );
          }

          const service = UsageLimitService.create(prisma);
          await service.checkAndSendWarning({
            organizationId: org.id,
            currentMonthMessagesCount,
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

  return res.status(200).json({ success: true });
}
