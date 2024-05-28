import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "../../../server/db";
import { getDebugger } from "../../../utils/logger";

export const debug = getDebugger("langwatch:auth:validate");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).end(); // Only accept POST requests
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

  return res.status(200).json({ success: true });
}
