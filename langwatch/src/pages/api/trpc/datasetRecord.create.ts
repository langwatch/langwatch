import type { NextApiRequest, NextApiResponse } from "next";
import trpc from "./[trpc]";
import { getPayloadSizeHistogram } from "../../../server/metrics";

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
  req.query.trpc = "datasetRecord.create";
  getPayloadSizeHistogram("dataset_record").observe(
    JSON.stringify(req.body).length
  );
  return trpc(req, res);
}
