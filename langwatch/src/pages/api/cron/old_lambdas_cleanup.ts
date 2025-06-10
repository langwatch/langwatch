import type { NextApiRequest, NextApiResponse } from "next";
import cleanupOldLambdas from "~/tasks/cleanupOldLambdas";

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
    await cleanupOldLambdas();
    res.status(200).json({ message: "Old lambdas deleted successfully" });
  } catch (error: any) {
    res.status(500).json({
      message: "Error deleting old lambdas",
      error: error?.message ? error.message.toString() : `${error}`,
    });
  }
}
