import type { NextApiRequest, NextApiResponse } from "next";
import trpc from "./[trpc]";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "20mb",
    },
    responseLimit: "40mb",
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  req.query.trpc = "dataset.upsert";
  return trpc(req, res);
}
