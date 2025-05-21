import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "../../../server/db";

import { createLogger } from "../../../utils/logger";
import { TriggerAction } from "@prisma/client";

const logger = createLogger("langwatch:dataset:slug");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).end(); // Only accept GET requests
  }

  const authToken = req.headers["x-auth-token"];

  if (!authToken) {
    return res
      .status(401)
      .json({ message: "X-Auth-Token header is required." });
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken as string },
  });

  if (!project) {
    return res.status(401).json({ message: "Invalid auth token." });
  }

  const { slackHook, name, message, filter } = req.body;

  if (!slackHook || !name || !message || !filter) {
    return res.status(400).json({
      message:
        "Please provide all required fields (slackHook, name, message, filter)",
    });
  }

  const filters = JSON.parse(filter);

  try {
    const trigger = await prisma.trigger.create({
      data: {
        projectId: project.id,
        action: TriggerAction.SEND_SLACK_MESSAGE,
        name,
        message,
        filters,
        actionParams: {
          slackHook,
        },
      },
    });
  } catch (error) {
    logger.error({ error }, "Error creating trigger");
    return res.status(500).json({ message: "Error creating trigger" });
  }
}
