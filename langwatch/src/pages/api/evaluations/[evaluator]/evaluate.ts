import type { NextApiRequest, NextApiResponse } from "next";

import { handleEvaluatorCall } from "./[subpath]/evaluate";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "30mb",
    },
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  return handleEvaluatorCall(req, res, false);
}
