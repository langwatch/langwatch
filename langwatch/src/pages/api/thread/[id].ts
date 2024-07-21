import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "~/server/db";

import { getTracesByThreadId } from "~/server/api/routers/traces";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).end();
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

  const threadId = req.query.id as string;

  const traces = await getTracesByThreadId({
    projectId: project?.id,
    threadId,
  });

  return res.status(200).json({ traces });
}
