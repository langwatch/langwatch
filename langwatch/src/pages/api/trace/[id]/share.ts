import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "~/server/db";
import { createShare } from "~/server/api/routers/share";

import { getTraceById } from "~/server/api/routers/traces";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
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

  const traceId = req.query.id as string;

  const trace = await getTraceById({
    traceId,
    projectId: project.id,
  });

  if (!trace) {
    return res
      .status(404)
      .json({ status: "error", message: "Trace not found." });
  }

  const share = await createShare({
    projectId: project.id,
    resourceType: "TRACE",
    resourceId: traceId,
  });

  return res
    .status(200)
    .json({ status: "success", path: `/share/${share.id}` });
}
