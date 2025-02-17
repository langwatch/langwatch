import { type NextApiRequest, type NextApiResponse } from "next";
import { runWorkflow } from "../workflows/[workflowId]/[versionId]/run";

/**
 * @deprecated Use /api/workflows/[workflowId]/[versionId]/run instead
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { params } = req.query;
  const [workflowId, versionId] = params as [string, string];

  return runWorkflow(req, res, workflowId, versionId);
}
