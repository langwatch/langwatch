import { type NextApiRequest, type NextApiResponse } from "next";
import { posthog } from "~/server/posthog";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const { event, instance_id, ...properties } = req.body;

  try {
    posthog.capture({
      distinctId: instance_id, // Use organization ID as the distinct ID
      event,
      properties,
    });

    // Optional: await posthog.flush(); (only if blocking needed)
  } catch (error) {
    console.error("PostHog capture failed:", error);
  }

  res.status(200).json({ message: "Event captured" });
}
