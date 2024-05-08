import type { NextApiRequest, NextApiResponse } from "next";
import rerunChecks from "../../tasks/rerunChecks";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const checkId = req.query.checkId as string;

    await rerunChecks(checkId);

    res.status(200).json({ message: "Checks rescheduled" });
  } catch (error: any) {
    res.status(500).json({
      message: "Error starting worker",
      error: error?.message ? error?.message.toString() : `${error}`,
    });
  }
}
