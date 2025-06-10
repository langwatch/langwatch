import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "~/server/db";
import { esClient, TRACE_INDEX } from "~/server/elasticsearch";
import { AnalyticsKey } from "@prisma/client";

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
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // For each project, count traces and store in Analytics
  for (const project of projects) {
    const queryBody = {
      query: {
        bool: {
          must: [
            { term: { "metadata.project_id": project.id } },
            {
              range: {
                "@timestamp": {
                  gte: today.toISOString(),
                  lt: new Date(
                    today.getTime() + 24 * 60 * 60 * 1000
                  ).toISOString(),
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

    // Store the count in Analytics
    await prisma.analytics.create({
      data: {
        projectId: project.id,
        key: AnalyticsKey.PROJECT_TRACE_COUNT_PER_DAY,
        numericValue: traceCount,
        value: {
          date: today.toISOString(),
          count: traceCount,
        },
      },
    });
  }

  return res.status(200).json({ success: true });
}
