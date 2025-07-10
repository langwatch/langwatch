import type { NextApiRequest, NextApiResponse } from "next";
import trpc from "./[trpc]";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "6mb",
    },
    responseLimit: "10mb",
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  req.query.trpc = "optimization.getComponents";
  return trpc(req, res);
}
