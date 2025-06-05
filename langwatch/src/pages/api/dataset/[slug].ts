import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "../../../server/db";

import { createLogger } from "../../../utils/logger";

const logger = createLogger("langwatch:dataset:get");

const MAX_LIMIT_MB = 25;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).end(); // Only accept GET requests
  }

  const authToken = req.headers["x-auth-token"];

  if (!authToken) {
    return res
      .status(401)
      .json({ message: "X-Auth-Token header is required." });
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken as string },
  });

  if (!project) {
    return res.status(401).json({ message: "Invalid auth token." });
  }

  try {
    const dataset = await prisma.dataset.findFirst({
      where: {
        projectId: project.id,
        OR: [
          { slug: req.query.slug as string },
          { id: req.query.slug as string },
        ],
      },
    });

    if (!dataset) {
      return res
        .status(404)
        .json({ status: "error", message: "Dataset not found." });
    }

    const datasetRecords = await prisma.datasetRecord.findMany({
      where: { datasetId: dataset.id, projectId: project.id },
    });

    const responseSize = JSON.stringify(datasetRecords).length;

    if (responseSize > MAX_LIMIT_MB * 1024 * 1024) {
      // Convert MB to bytes
      return res.status(401).json({
        status: "error",
        message: `Dataset size exceeds ${MAX_LIMIT_MB}MB limit`,
      });
    }

    return res.status(200).json({ data: datasetRecords });
  } catch (e) {
    logger.error(
      { error: e, projectId: project.id },
      "error fetching dataset records"
    );
    return res
      .status(500)
      .json({ status: "error", message: "Internal server error." });
  }
}
