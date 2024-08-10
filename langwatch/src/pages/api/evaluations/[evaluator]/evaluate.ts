import { type NextApiRequest, type NextApiResponse } from "next";

import { handleEvaluatorCall } from "./[subpath]/evaluate";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  return handleEvaluatorCall(req, res, false);
}
