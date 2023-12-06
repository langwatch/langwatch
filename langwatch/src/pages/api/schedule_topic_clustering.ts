import type { NextApiRequest, NextApiResponse } from "next";
import { scheduleTopicClustering } from "../../trace_checks/queue";

export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse
) {
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
