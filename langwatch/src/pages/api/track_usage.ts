import type { NextApiRequest, NextApiResponse } from "next";
import { captureException } from "~/utils/posthogErrorCapture";
import { getPostHogInstance } from "../../server/posthog";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const { event, instance_id, ...properties } = req.body;

  const posthog = getPostHogInstance();
  if (posthog) {
    try {
      posthog.capture({
        distinctId: instance_id, // Use organization ID as the distinct ID
        event,
        properties,
      });
    } catch (error) {
      captureException(error);
    }
  }

  res.status(200).json({ message: "Event captured" });
}
