import type { Project, Trigger } from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "~/server/db";
import { createLogger } from "~/utils/logger/server";
import { processCustomGraphTrigger } from "./customGraphTrigger";
import { processTraceBasedTrigger } from "./traceBasedTrigger";

const logger = createLogger("langwatch:cron:triggers");

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
      try {
        const result = await processCustomGraphTrigger(trigger, projects);
        results.push(result);
      } catch (error) {
        logger.error(
          { triggerId: trigger.id, error },
          "error processing custom graph trigger",
        );
        results.push({
          triggerId: trigger.id,
          status: "error",
          message: error instanceof Error ? error.message : "Unknown error",
          type: "customGraph",
        });
      }
    } else {
      // Existing trace-based trigger logic
      try {
        const result = await processTraceBasedTrigger(trigger, projects);
        results.push(result);
      } catch (error) {
        logger.error(
          { triggerId: trigger.id, error },
          "error processing trace-based trigger",
        );
        results.push({
          triggerId: trigger.id,
          status: "error",
          message: error instanceof Error ? error.message : "Unknown error",
          type: "traceBased",
        });
      }
    }
  }

  return res.status(200).json(results);
}
