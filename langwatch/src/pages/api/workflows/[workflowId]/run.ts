import type { NextApiRequest, NextApiResponse } from "next";
import { runWorkflow } from "./[versionId]/run";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  return runWorkflow(req, res, req.query.workflowId as string, undefined);
}
