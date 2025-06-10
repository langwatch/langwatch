import { prisma } from "~/server/db";
import { esClient, TRACE_INDEX } from "~/server/elasticsearch";
import { AnalyticsKey } from "@prisma/client";

export default async function execute() {
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
    const startDate = new Date(project.createdAt);
    startDate.setHours(0, 0, 0, 0);

    // Generate array of dates from project creation to today
    const dates: Date[] = [];
    let currentDate = new Date(startDate);
    while (currentDate <= today) {
      dates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // For each date, get trace count and store in Analytics
    for (const date of dates) {
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const queryBody = {
        query: {
          bool: {
            must: [
              { term: { "metadata.project_id": project.id } },
              {
                range: {
                  "@timestamp": {
                    gte: date.toISOString(),
                    lt: nextDate.toISOString(),
                  },
                },
              },
            ],
          },
        },
      };

      const result = (await client.search({
        index: TRACE_INDEX.alias,
        body: queryBody,
      })) as any;

      const traceCount = result.hits.total.value;

      // Check if we already have data for this date
      const existingAnalytics = await prisma.analytics.findFirst({
        where: {
          projectId: project.id,
          key: AnalyticsKey.PROJECT_TRACE_COUNT_PER_DAY,
          createdAt: {
            gte: date,
            lt: nextDate,
          },
        },
      });

      // Only create if we don't have data for this date
      if (!existingAnalytics) {
        await prisma.analytics.create({
          data: {
            projectId: project.id,
            key: AnalyticsKey.PROJECT_TRACE_COUNT_PER_DAY,
            numericValue: traceCount,
            value: {
              date: date.toISOString(),
              count: traceCount,
            },
            createdAt: date, // Set the createdAt to match the date we're backfilling
          },
        });
      }
    }
  }
  return true;
}
