import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "~/server/db";
import { esClient } from "~/server/elasticsearch";
import { type Prisma } from "@prisma/client";
import { ANALYTICS_KEYS } from "~/types";
import { createScenarioAnalyticsQueriesForAllEventTypes } from "~/server/scenario-analytics";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
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
    0
  );
  const endTimestamp = Date.UTC(
    yesterdayEnd.getUTCFullYear(),
    yesterdayEnd.getUTCMonth(),
    yesterdayEnd.getUTCDate(),
    0,
    0,
    0,
    0
  );

  // Create queries for all event types for all projects
  const msearchBody = projects.flatMap((project) =>
    createScenarioAnalyticsQueriesForAllEventTypes(
      project.id,
      startTimestamp,
      endTimestamp
    )
  );

  // Process results - each project has 4 queries (total, message_snapshot, run_started, run_finished)
  const analyticsToCreate: Prisma.AnalyticsCreateManyInput[] = [];

  try {
    // Execute multi-search to get counts for all projects and event types
    const msearchResult = await client.msearch({
      body: msearchBody,
    });

    for (let i = 0; i < projects.length; i++) {
      const project = projects[i];
      if (!project) continue;

      const baseIndex = i * 4;

      // Helper function to safely get hit count
      const getHitCount = (index: number): number => {
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
      };

      // Total scenario events
      const totalEvents = getHitCount(baseIndex);
      if (totalEvents > 0) {
        analyticsToCreate.push({
          projectId: project.id,
          key: ANALYTICS_KEYS.SCENARIO_EVENT_COUNT_PER_DAY,
          numericValue: totalEvents,
          createdAt: yesterday,
        });
      }

      // Message snapshot events
      const messageSnapshots = getHitCount(baseIndex + 1);
      if (messageSnapshots > 0) {
        analyticsToCreate.push({
          projectId: project.id,
          key: ANALYTICS_KEYS.SCENARIO_MESSAGE_SNAPSHOT_COUNT_PER_DAY,
          numericValue: messageSnapshots,
          createdAt: yesterday,
        });
      }

      // Run started events
      const runStarted = getHitCount(baseIndex + 2);
      if (runStarted > 0) {
        analyticsToCreate.push({
          projectId: project.id,
          key: ANALYTICS_KEYS.SCENARIO_RUN_STARTED_COUNT_PER_DAY,
          numericValue: runStarted,
          createdAt: yesterday,
        });
      }

      // Run finished events
      const runFinished = getHitCount(baseIndex + 3);
      if (runFinished > 0) {
        analyticsToCreate.push({
          projectId: project.id,
          key: ANALYTICS_KEYS.SCENARIO_RUN_FINISHED_COUNT_PER_DAY,
          numericValue: runFinished,
          createdAt: yesterday,
        });
      }
    }

    if (analyticsToCreate.length > 0) {
      // Check for existing entries for all analytics keys
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

      // Filter out entries that already exist
      const newAnalyticsToCreate = analyticsToCreate.filter(
        (entry) =>
          !existingEntries.some(
            (existing) =>
              existing.projectId === entry.projectId &&
              existing.key === entry.key
          )
      );

      if (newAnalyticsToCreate.length > 0) {
        // Batch create only new analytics entries
        await prisma.analytics.createMany({
          data: newAnalyticsToCreate,
          skipDuplicates: true,
        });
        // Group analytics by type for better logging
        const analyticsByType = newAnalyticsToCreate.reduce(
          (acc, entry) => {
            acc[entry.key] = (acc[entry.key] ?? 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        );

        console.log(
          `[Scenario Analytics] Created ${
            newAnalyticsToCreate.length
          } entries for ${yesterday.toISOString().split("T")[0]}:`,
          analyticsByType
        );
      } else {
        console.log(
          `[Scenario Analytics] All entries exist for ${
            yesterday.toISOString().split("T")[0]
          }`
        );
      }
    } else {
      console.log(
        `[Scenario Analytics] No scenario events found for ${
          yesterday.toISOString().split("T")[0]
        }`
      );
    }
  } catch (error) {
    console.error("[Scenario Analytics] Error:", error);
    return res
      .status(500)
      .json({ success: false, error: "Failed to process scenario analytics" });
  }

  return res.status(200).json({
    success: true,
    projectsProcessed: projects.length,
    analyticsCreated: analyticsToCreate.length,
  });
}
