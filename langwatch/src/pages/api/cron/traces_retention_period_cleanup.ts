import type { NextApiRequest, NextApiResponse } from "next";
import { deleteTracesRetentionPolicy } from "~/tasks/deleteTracesRetentionPolicy";
import { migrateToColdStorage } from "../../../tasks/cold/moveTracesToColdStorage";

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
    const projectId = req.query.projectId as string | undefined;
    const movedToColdStorage = await migrateToColdStorage(projectId);
    const totalDeleted = await deleteTracesRetentionPolicy(projectId);

    res.status(200).json({
      message: "Traces retention period maintenance completed successfully",
      totalDeleted,
      movedToColdStorage: movedToColdStorage?.migrated,
    });
  } catch (error: any) {
    res.status(500).json({
      message: "Error deleting old traces",
      error: error?.message ? error.message.toString() : `${error}`,
    });
  }
}
