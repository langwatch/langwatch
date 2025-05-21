import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "../../../server/db";

import { createLogger } from "../../../utils/logger";
import { TriggerAction, AlertType } from "@prisma/client";
import { z } from "zod";

const logger = createLogger("langwatch:dataset:slug");

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

  const filterSchema = z.object({
    metadata: z
      .object({
        user_id: z.array(z.string()).optional(),
        thread_id: z.array(z.string()).optional(),
        customer_id: z.array(z.string()).optional(),
        labels: z.array(z.string()).optional(),
        custom_value: z.record(z.any()).optional(),
      })
      .refine(
        (data) =>
          (data.user_id && data.user_id.length > 0) ||
          (data.thread_id && data.thread_id.length > 0) ||
          (data.customer_id && data.customer_id.length > 0) ||
          (data.labels && data.labels.length > 0) ||
          (data.custom_value && Object.keys(data.custom_value).length > 0),
        {
          message:
            "At least one metadata field must be provided (user_id, thread_id, customer_id, labels, custom_value)",
        }
      ),
  });

  const schema = z.object({
    slack_webhook: z.string(),
    name: z.string(),
    message: z.string().optional(),
    filters: filterSchema,
    alert_type: z.nativeEnum(AlertType),
  });

  try {
    const validatedData = schema.parse(req.body);

    // Transform to dot notation format
    const flattenedFilters = Object.entries(
      validatedData.filters.metadata
    ).reduce(
      (acc, [key, value]) => ({
        ...acc,
        [`metadata.${key === "custom_value" ? "value" : key}`]: value,
      }),
      {}
    );

    const trigger = await prisma.trigger.create({
      data: {
        projectId: project.id,
        action: TriggerAction.SEND_SLACK_MESSAGE,
        name: validatedData.name,
        message: validatedData.message,
        filters: JSON.stringify(flattenedFilters),
        actionParams: {
          slackWebhook: validatedData.slack_webhook,
        },
        alertType: validatedData.alert_type,
      },
    });

    return res.status(200).json({ trigger });
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
