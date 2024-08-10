import { type NextApiRequest, type NextApiResponse } from "next";

import { handleEvaluatorCall } from "../../evaluations/[evaluator]/[subpath]/evaluate";

/**
 * @deprecated
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  return handleEvaluatorCall(req, res, true);
}
