import type { NextApiRequest, NextApiResponse } from "next";
import type { Trigger, Project } from "@prisma/client";
import { prisma } from "~/server/db";
import { processCustomGraphTrigger } from "./customGraphTrigger";
import { processTraceBasedTrigger } from "./traceBasedTrigger";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).end();
  }

  // let cronApiKey = req.headers.authorization;
  // cronApiKey = cronApiKey?.startsWith("Bearer ")
  //   ? cronApiKey.slice(7)
  //   : cronApiKey;

  // if (cronApiKey !== process.env.CRON_API_KEY) {
  //   return res.status(401).end();
  // }

  let triggers: Trigger[];
  let projects: Project[];

  try {
    projects = await prisma.project.findMany({
      where: {
        firstMessage: true,
      },
    });

    triggers = await prisma.trigger.findMany({
      where: {
        active: true,
        projectId: {
          in: projects.map((project) => project.id),
        },
      },
    });
  } catch (error) {
    return res.status(500).json({
      error: "Failed to fetch triggers",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }

  const results = [];

  for (const trigger of triggers) {
    // Check if this is a custom graph alert (has customGraphId)
    if (trigger.customGraphId) {
      const result = await processCustomGraphTrigger(trigger, projects);
      results.push(result);
    } else {
      // Existing trace-based trigger logic
      const result = await processTraceBasedTrigger(trigger, projects);
      results.push(result);
    }
  }

  return res.status(200).json(results);
}
