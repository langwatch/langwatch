import type { NextApiRequest, NextApiResponse } from "next";
import trpc from "./[trpc]";

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
  req.query.trpc = "datasetRecord.update";
  return trpc(req, res);
}
