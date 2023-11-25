import type { NextApiRequest, NextApiResponse } from "next";
import { start } from "../../trace_checks/worker";

export const maxDuration = 300; // This is also used by Vercel directly for the maximum runtime of this as a serverless function in seconds, don't rename it: https://vercel.com/docs/functions/configuring-functions/duration

export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const maxRuntimeMs = (maxDuration - 60) * 1000; // Runs for a minute less than the max duration

    await start(undefined, maxRuntimeMs);

    res.status(200).json({ message: "Worker done" });
  } catch (error: any) {
    res.status(500).json({
      message: "Error starting worker",
      error: error?.message ? error?.message.toString() : `${error}`,
    });
  }
}
