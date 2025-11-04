import type { AggregationsCalendarInterval } from "@elastic/elasticsearch/lib/api/types";
import { prisma } from "~/server/db";
import { esClient } from "~/server/elasticsearch";
import { createScenarioAnalyticsQueriesForAllEventTypes } from "~/server/scenario-analytics";
import { ANALYTICS_KEYS } from "~/types";
import { createLogger } from "~/utils/logger";

const logger = createLogger("langwatch:backfillScenarioAnalytics");

interface DateHistogramBucket {
  key_as_string: string;
  doc_count: number;
}

export default async function execute() {
  logger.info("Starting backfillScenarioAnalytics...");

  // Get all projects
  const projects = await prisma.project.findMany({
    select: {
      id: true,
      createdAt: true,
    },
  });

  const client = await esClient({ test: true });
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // For each project, backfill from creation date to today
  for (const project of projects) {
    try {
      logger.info({ projectId: project.id }, "Processing project");
      const startDate = new Date(project.createdAt);
      startDate.setHours(0, 0, 0, 0);

      // Create multi-search body for all event types with date histogram aggregation
      const msearchBody = createScenarioAnalyticsQueriesForAllEventTypes({
        projectId: project.id,
        startTime: startDate.getTime(),
        endTime: today.getTime(),
        includeDateHistogram: true,
        dateHistogramOptions: {
          calendarInterval: "day" as AggregationsCalendarInterval,
          format: "yyyy-MM-dd",
          timeZone: "UTC",
        },
      });

      const msearchResult = await client.msearch({
        body: msearchBody,
      });

      // Helper function to safely extract daily counts
      const getDailyCounts = (index: number): DateHistogramBucket[] => {
        const response = msearchResult.responses[index];
        if (
          response &&
          "aggregations" in response &&
          response.aggregations &&
          "daily_counts" in response.aggregations
        ) {
          const dailyCounts = response.aggregations.daily_counts as any;
          return dailyCounts.buckets || [];
        }
        return [];
      };

      const totalEventCounts = getDailyCounts(0);
      const messageSnapshotCounts = getDailyCounts(1);
      const runStartedCounts = getDailyCounts(2);
      const runFinishedCounts = getDailyCounts(3);

      const allCounts = [
        {
          counts: totalEventCounts,
          key: ANALYTICS_KEYS.SCENARIO_EVENT_COUNT_PER_DAY,
          name: "total events",
        },
        {
          counts: messageSnapshotCounts,
          key: ANALYTICS_KEYS.SCENARIO_MESSAGE_SNAPSHOT_COUNT_PER_DAY,
          name: "message snapshots",
        },
        {
          counts: runStartedCounts,
          key: ANALYTICS_KEYS.SCENARIO_RUN_STARTED_COUNT_PER_DAY,
          name: "run started",
        },
        {
          counts: runFinishedCounts,
          key: ANALYTICS_KEYS.SCENARIO_RUN_FINISHED_COUNT_PER_DAY,
          name: "run finished",
        },
      ];

      const totalDays = Math.max(...allCounts.map((c) => c.counts.length));
      logger.info(
        { projectId: project.id, totalDays },
        "Found days with scenario events for project"
      );

      if (totalDays === 0) {
        logger.info(
          { projectId: project.id },
          "No scenario events found for project"
        );
        continue;
      }

      // Get existing analytics for this project to avoid duplicates
      const existingAnalytics = await prisma.analytics.findMany({
        where: {
          projectId: project.id,
          key: {
            in: [
              ANALYTICS_KEYS.SCENARIO_EVENT_COUNT_PER_DAY,
              ANALYTICS_KEYS.SCENARIO_MESSAGE_SNAPSHOT_COUNT_PER_DAY,
              ANALYTICS_KEYS.SCENARIO_RUN_STARTED_COUNT_PER_DAY,
              ANALYTICS_KEYS.SCENARIO_RUN_FINISHED_COUNT_PER_DAY,
            ],
          },
          createdAt: {
            gte: startDate,
            lt: today,
          },
        },
        select: {
          createdAt: true,
          key: true,
        },
      });

      // Create a set of existing analytics entries (date + key)
      const existingEntries = new Set(
        existingAnalytics.map(
          (a) => `${a.createdAt.toISOString().split("T")[0]}-${a.key}`
        )
      );

      // Prepare batch of analytics to create
      const analyticsToCreate: Array<{
        projectId: string;
        key: string;
        numericValue: number;
        createdAt: Date;
      }> = [];

      for (const { counts, key, name } of allCounts) {
        for (const bucket of counts) {
          if (
            bucket.doc_count > 0 &&
            !existingEntries.has(`${bucket.key_as_string}-${key}`)
          ) {
            analyticsToCreate.push({
              projectId: project.id,
              key,
              numericValue: bucket.doc_count,
              createdAt: new Date(bucket.key_as_string),
            });
          }
        }
      }

      if (analyticsToCreate.length > 0) {
        // Batch create analytics
        await prisma.analytics.createMany({
          data: analyticsToCreate,
          skipDuplicates: true,
        });

        // Group analytics by type for better logging
        const analyticsByType = analyticsToCreate.reduce(
          (acc, entry) => {
            acc[entry.key] = (acc[entry.key] ?? 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        );

        logger.info(
          {
            projectId: project.id,
            analyticsByType,
            totalCreated: analyticsToCreate.length,
          },
          "Created analytics entries for project"
        );
      } else {
        logger.info(
          { projectId: project.id },
          "No new analytics needed for project"
        );
      }
    } catch (error) {
      logger.error(
        { projectId: project.id, error },
        "Error processing project"
      );
      logger.info("Continuing with next project...");
    }
  }

  logger.info("Completed backfillScenarioAnalytics");
  return true;
}
