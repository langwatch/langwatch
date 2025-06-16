import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "~/server/db";
import { esClient, TRACE_INDEX } from "~/server/elasticsearch";
import { AnalyticsKey, type Prisma } from "@prisma/client";

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
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  const yesterdayEnd = new Date(yesterday);
  yesterdayEnd.setDate(yesterdayEnd.getDate() + 1);

  console.log(`Counting traces for ${yesterday.toISOString().split("T")[0]}`);

  // Create a multi-search query for all projects
  const msearchBody = projects.flatMap((project) => [
    { index: TRACE_INDEX.alias },
    {
      size: 0,
      query: {
        bool: {
          must: [
            { term: { "metadata.project_id": project.id } },
            {
              range: {
                "timestamps.started_at": {
                  gte: yesterday.getTime(),
                  lt: yesterdayEnd.getTime(),
                },
              },
            },
          ],
        },
      },
    },
  ]);

  // Execute multi-search to get counts for all projects in one request
  const msearchResult = await client.msearch({
    body: msearchBody,
  });

  // Prepare analytics entries to create
  const analyticsToCreate = msearchResult.responses
    .map((response: any, index: number) => {
      const traceCount = response?.hits?.total?.value ?? 0;
      if (traceCount === 0) {
        console.log(
          `No traces found for project ${projects[index]?.id} on ${
            yesterday.toISOString().split("T")[0]
          }`
        );
        return null;
      }
      return {
        projectId: projects[index]?.id,
        key: AnalyticsKey.PROJECT_TRACE_COUNT_PER_DAY,
        numericValue: traceCount,
        createdAt: yesterday, // Use yesterday's date for the analytics entry
      } as Prisma.AnalyticsCreateManyInput;
    })
    .filter(
      (entry): entry is Prisma.AnalyticsCreateManyInput => entry !== null
    );

  if (analyticsToCreate.length > 0) {
    // Batch create all analytics entries in one database operation
    await prisma.analytics.createMany({
      data: analyticsToCreate,
      skipDuplicates: true,
    });
    console.log(
      `Created ${analyticsToCreate.length} analytics entries for ${
        yesterday.toISOString().split("T")[0]
      }`
    );
  } else {
    console.log(
      `No analytics entries to create for ${
        yesterday.toISOString().split("T")[0]
      }`
    );
  }

  return res.status(200).json({ success: true });
}
