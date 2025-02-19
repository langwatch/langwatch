import { type NextApiRequest, type NextApiResponse } from "next";
import { runWorkflow as runWorkflowFn } from "~/server/workflows/runWorkflow";
import { prisma } from "../../../../../server/db";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  return runWorkflow(
    req,
    res,
    req.query.workflowId as string,
    req.query.versionId as string | undefined
  );
}

export async function runWorkflow(
  req: NextApiRequest,
  res: NextApiResponse,
  workflowId: string,
  versionId: string | undefined
) {
  if (req.method !== "POST") {
    return res.status(405).end();
  }

  const xAuthToken = req.headers["x-auth-token"];
  const authHeader = req.headers.authorization;
  const authToken =
    xAuthToken ??
    (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);

  if (!authToken) {
    return res.status(401).json({
      message:
        "Authentication token is required. Use X-Auth-Token header or Authorization: Bearer token.",
    });
  }

  if (
    req.headers["content-type"] !== "application/json" ||
    typeof req.body !== "object"
  ) {
    return res.status(400).json({ message: "Invalid body, expecting json" });
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken as string },
    include: {
      team: true,
    },
  });

  if (!project) {
    return res.status(401).json({ message: "Invalid auth token." });
  }

  try {
    const result = await runWorkflowFn(
      workflowId,
      project.id,
      req.body,
      versionId
    );
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ message: (error as Error).message });
  }
}
