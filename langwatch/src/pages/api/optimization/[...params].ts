import { type NextApiRequest, type NextApiResponse } from "next";
import { executeWorkflowEvaluation } from "~/utils/executeEvalWorkflow";
import { prisma } from "../../../server/db";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).end();
  }

  const xAuthToken = req.headers["x-auth-token"];
  const authHeader = req.headers.authorization;
  const { params } = req.query;
  const [workflowId, versionId] = params as [string, string];

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
    const result = await executeWorkflowEvaluation(
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
