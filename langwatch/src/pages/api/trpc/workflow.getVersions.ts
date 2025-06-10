import type { NextApiRequest, NextApiResponse } from "next";
import trpc from "./[trpc]";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "5mb",
    },
    responseLimit: "20mb",
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  req.query.trpc = "workflow.getVersions";
  return trpc(req, res);
}
