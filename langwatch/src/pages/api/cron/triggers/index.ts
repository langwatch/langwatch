import type { NextApiRequest, NextApiResponse } from "next";
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

  const projects = await prisma.project.findMany({
    where: {
      firstMessage: true,
    },
  });

  const triggers = await prisma.trigger.findMany({
    where: {
      active: true,
      projectId: {
        in: projects.map((project) => project.id),
      },
    },
  });

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

