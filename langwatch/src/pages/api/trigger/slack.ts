import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "../../../server/db";

import { createLogger } from "../../../utils/logger";
import { TriggerAction, AlertType } from "@prisma/client";
import { z } from "zod";
import { filterFieldsEnum } from "../../../server/filters/types";

const logger = createLogger("langwatch:trigger:slack");

/**
 * Filter schema for trigger creation
 *
 * Example request body:
 * {
 *   "filters": {
 *     "metadata.user_id": ["user123"],  // Note: keys must include the full path
 *     "metadata.customer_id": ["cust456"]
 *   }
 * }
 */
const filterSchema = z
  .record(
    filterFieldsEnum,
    z.union([
      z.array(z.string()),
      z.record(z.string(), z.array(z.string())),
      z.record(z.string(), z.record(z.string(), z.array(z.string()))),
    ])
  )
  .default({});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).end(); // Only accept POST requests
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

  const schema = z.object({
    slack_webhook: z.string().url("The Slack webhook must be a valid URL"),
    name: z.string(),
    message: z.string().optional(),
    filters: filterSchema,
    alert_type: z.nativeEnum(AlertType),
  });

  try {
    const validatedData = schema.parse(req.body);

    const trigger = await prisma.trigger.create({
      data: {
        projectId: project.id,
        action: TriggerAction.SEND_SLACK_MESSAGE,
        name: validatedData.name,
        message: validatedData.message,
        filters: JSON.stringify(validatedData.filters),
        actionParams: {
          slackWebhook: validatedData.slack_webhook,
        },
        alertType: validatedData.alert_type,
      },
    });

    return res.status(200).json({
      message: "Slack trigger created successfully",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        message: "Invalid request data",
        errors: error.errors,
      });
    }

    logger.error({ error }, "Error creating trigger");
    return res.status(500).json({ message: "Error creating trigger" });
  }
}
