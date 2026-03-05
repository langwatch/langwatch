import type { NextApiRequest, NextApiResponse } from "next";
import { getProtectionsForProject } from "~/server/api/utils";
import { prisma } from "~/server/db";
import { getTraceById } from "~/server/elasticsearch/traces";
import {
  generateAsciiTree,
  toLLMModeTrace,
} from "~/server/traces/trace-formatting";
import { formatSpansDigest } from "~/server/tracer/spanToReadableSpan";

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

  try {
    const project = await prisma.project.findUnique({
      where: { apiKey: authToken as string },
    });

    if (!project) {
      return res.status(401).json({ message: "Invalid auth token." });
    }

    const traceId = req.query.id as string;
    const formatParam = req.query.format as string | undefined;
    const llmMode = req.query.llmMode === "true" || req.query.llmMode === "1";
    const format = formatParam ?? (llmMode ? "digest" : "json");

    // Signal deprecation — consumers should migrate to /api/traces/:traceId
    res.setHeader("Deprecation", "true");
    res.setHeader("Link", `</api/traces/${traceId}?format=${format}>; rel="successor-version"`);

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

    if (format === "digest") {
      return res.status(200).json({
        trace_id: traceId,
        formatted_trace: formatSpansDigest(trace.spans ?? []),
        timestamps: trace.timestamps,
        metadata: trace.metadata,
        evaluations: trace.evaluations,
      });
    }

    // Generate ASCII tree representation
    const asciiTree = generateAsciiTree(trace?.spans);

    return res.status(200).json({
      ...trace,
      ascii_tree: asciiTree,
    });
  } catch (error) {
    console.error("[API /api/trace/:id] Error:", error);
    return res.status(500).json({
      message: "Internal Server Error",
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

// Re-export for backward compatibility with existing imports from this module
export { generateAsciiTree, toLLMModeTrace } from "~/server/traces/trace-formatting";
