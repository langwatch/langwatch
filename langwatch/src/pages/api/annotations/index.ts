import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "../../../server/db";

import { createLogger } from "../../../utils/logger.server";

const logger = createLogger("langwatch:annotations:index");

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
    const annotations = await prisma.annotation.findMany({
      where: { projectId: project.id },
    });

    if (!annotations || annotations.length === 0) {
      return res
        .status(404)
        .json({ status: "error", message: "No annotations found." });
    }

    return res.status(200).json({ data: annotations });
  } catch (e) {
    logger.error({ error: e, projectId: project.id }, 'error fetching annotations');
    return res
      .status(500)
      .json({ status: "error", message: "Internal server error." });
  }
}
