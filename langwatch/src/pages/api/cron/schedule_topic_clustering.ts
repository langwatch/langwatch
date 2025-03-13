import type { NextApiRequest, NextApiResponse } from "next";
import { scheduleTopicClustering } from "~/server/background/queues/topicClusteringQueue";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  let cronApiKey = req.headers.authorization;
  cronApiKey = cronApiKey?.startsWith("Bearer ")
    ? cronApiKey.slice(7)
    : cronApiKey;

  if (cronApiKey !== process.env.CRON_API_KEY) {
    return res.status(401).end();
  }

  try {
    await scheduleTopicClustering();

    res.status(200).json({ message: "Topic clustering scheduled" });
  } catch (error: any) {
    res.status(500).json({
      message: "Error starting worker",
      error: error?.message ? error?.message.toString() : `${error}`,
    });
  }
}
