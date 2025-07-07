import { prisma } from "~/server/db";
import { esClient } from "~/server/elasticsearch";
import type { AggregationsCalendarInterval } from "@elastic/elasticsearch/lib/api/types";
import { ANALYTICS_KEYS } from "~/types";
import { ScenarioEventType } from "~/app/api/scenario-events/[[...route]]/enums";
import { createScenarioAnalyticsQueriesForAllEventTypes } from "~/server/scenario-analytics";

interface DateHistogramBucket {
  key_as_string: string;
  doc_count: number;
}

export default async function execute() {
  console.log("Starting backfillScenarioAnalytics...");

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
      console.log(`\nProcessing project ${project.id}`);
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
      console.log(
        `Found ${totalDays} days with scenario events for project ${project.id}`
      );

      if (totalDays === 0) {
        console.log(`No scenario events found for project ${project.id}`);
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

        console.log(
          `Created ${analyticsToCreate.length} analytics entries for project ${project.id}:`,
          analyticsByType
        );
      } else {
        console.log(`No new analytics needed for project ${project.id}`);
      }
    } catch (error) {
      console.error(`Error processing project ${project.id}:`, error);
      console.log(`Continuing with next project...`);
    }
  }

  console.log("\nCompleted backfillScenarioAnalytics");
  return true;
}
