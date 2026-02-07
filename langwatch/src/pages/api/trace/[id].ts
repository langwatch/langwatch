import type { NextApiRequest, NextApiResponse } from "next";
import { getProtectionsForProject } from "~/server/api/utils";
import { prisma } from "~/server/db";
import { getTraceById } from "~/server/elasticsearch/traces";
import {
  generateAsciiTree,
  toLLMModeTrace,
} from "~/server/traces/trace-formatting";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
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

  const traceId = req.query.id as string;
  const llmMode = req.query.llmMode === "true" || req.query.llmMode === "1";

  const protections = await getProtectionsForProject(prisma, {
    projectId: project?.id,
  });
  const trace = await getTraceById({
    connConfig: { projectId: project?.id },
    traceId,
    protections,
    includeSpans: true,
    includeEvaluations: true,
  });
  if (!trace) {
    return res.status(404).json({ message: "Trace not found." });
  }

  // Generate ASCII tree representation
  const asciiTree = generateAsciiTree(trace?.spans);

  return res.status(200).json({
    ...(llmMode ? toLLMModeTrace(trace, asciiTree) : {}),
    spans: trace.spans,
    evaluations: trace.evaluations,
    ascii_tree: asciiTree,
    metadata: trace.metadata,
  });
}

// Re-export for backward compatibility with existing imports from this module
export { generateAsciiTree, toLLMModeTrace } from "~/server/traces/trace-formatting";
