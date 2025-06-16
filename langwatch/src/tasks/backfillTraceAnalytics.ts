import { prisma } from "~/server/db";
import { esClient, TRACE_INDEX } from "~/server/elasticsearch";
import { AnalyticsKey } from "@prisma/client";
import type { AggregationsCalendarInterval } from "@elastic/elasticsearch/lib/api/types";

interface DateHistogramBucket {
  key_as_string: string;
  doc_count: number;
}

export default async function execute() {
  console.log("Starting backfillTraceAnalytics...");

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
    console.log(`\nProcessing project ${project.id}`);
    const startDate = new Date(project.createdAt);
    startDate.setHours(0, 0, 0, 0);

    // Create a query that gets daily counts for all dates in one go
    const queryBody = {
      size: 0, // We don't need the actual documents
      query: {
        bool: {
          should: [
            { term: { project_id: project.id } },
            { term: { "metadata.project_id": project.id } },
          ],
          minimum_should_match: 1,
          must: [
            {
              range: {
                "timestamps.started_at": {
                  gte: startDate.getTime(),
                  lt: today.getTime(),
                },
              },
            },
          ],
        },
      },
      aggs: {
        daily_counts: {
          date_histogram: {
            field: "timestamps.started_at",
            calendar_interval: "day" as AggregationsCalendarInterval,
            format: "yyyy-MM-dd",
            time_zone: "UTC",
          },
        },
      },
    };

    const result = (await client.search({
      index: TRACE_INDEX.alias,
      body: queryBody,
    })) as any;

    const dailyCounts = result.aggregations.daily_counts
      .buckets as DateHistogramBucket[];

    console.log(
      `Found ${dailyCounts.length} days with traces for project ${project.id}`
    );

    if (dailyCounts.length === 0) {
      console.log(`No traces found for project ${project.id}`);
      continue;
    }

    // Get existing analytics for this project to avoid duplicates
    const existingAnalytics = await prisma.analytics.findMany({
      where: {
        projectId: project.id,
        key: AnalyticsKey.PROJECT_TRACE_COUNT_PER_DAY,
        createdAt: {
          gte: startDate,
          lt: today,
        },
      },
      select: {
        createdAt: true,
      },
    });

    // Create a set of dates that already have analytics
    const existingDates = new Set(
      existingAnalytics.map((a) => a.createdAt.toISOString().split("T")[0])
    );

    // Prepare batch of analytics to create
    const analyticsToCreate = dailyCounts
      .filter(
        (bucket) =>
          bucket.doc_count > 0 && !existingDates.has(bucket.key_as_string)
      )
      .map((bucket) => ({
        projectId: project.id,
        key: AnalyticsKey.PROJECT_TRACE_COUNT_PER_DAY,
        numericValue: bucket.doc_count,
        createdAt: new Date(bucket.key_as_string),
      }));

    if (analyticsToCreate.length > 0) {
      // Batch create analytics
      await prisma.analytics.createMany({
        data: analyticsToCreate,
        skipDuplicates: true,
      });
      console.log(
        `Created ${analyticsToCreate.length} analytics entries for project ${project.id}`
      );
    } else {
      console.log(`No new analytics needed for project ${project.id}`);
    }
  }

  console.log("\nCompleted backfillTraceAnalytics");
  return true;
}
