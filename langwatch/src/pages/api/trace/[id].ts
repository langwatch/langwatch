import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "~/server/db";

import {
  getTraceById,
  getEvaluationsMultiple,
  getSpansForTraceIds,
} from "~/server/api/routers/traces";
import { elasticSearchEvaluationsToEvaluations } from "../../../server/tracer/utils";
import type { Span } from "../../../server/tracer/types";

type SpanWithChildren = Span & { children: SpanWithChildren[] };

// Build a tree structure from spans
const buildTree = (spans: Span[]): Record<string, SpanWithChildren> => {
  const lookup: Record<string, SpanWithChildren> = {};

  spans.forEach((span) => {
    lookup[span.span_id] = { ...span, children: [] };
  });

  spans.forEach((span) => {
    const lookupSpan = lookup[span.span_id];
    if (span.parent_id && lookup[span.parent_id] && lookupSpan) {
      lookup[span.parent_id]?.children.push?.(lookupSpan);
    }
  });

  return lookup;
};

// Generate ASCII tree representation
export const generateAsciiTree = (spans: Span[]): string => {
  const tree = buildTree(spans);

  // Find root spans (spans without parents or with parents not in the spans list)
  const spansById = spans.reduce(
    (acc, span) => {
      acc[span.span_id] = span;
      return acc;
    },
    {} as Record<string, Span>
  );

  const rootSpans = spans.filter(
    (s) => !s.parent_id || !spansById[s.parent_id]
  );

  let result = ".\n";

  // Recursively build the tree
  const buildAsciiTree = (
    span: SpanWithChildren,
    prefix: string,
    isLast: boolean
  ): void => {
    // Add current span to result
    const connector = isLast ? "└── " : "├── ";
    const displayName = `${span.type || "unknown"}${
      span.name ? `: ${span.name}` : ""
    }${span.type === "llm" && "model" in span ? ` (${span.model})` : ""}`;
    result += `${prefix}${connector}${displayName}\n`;

    // Prepare prefix for children
    const childPrefix = prefix + (isLast ? "    " : "│   ");

    // Add children
    span.children.forEach((child, index) => {
      buildAsciiTree(child, childPrefix, index === span.children.length - 1);
    });
  };

  // Process each root span
  rootSpans.forEach((rootSpan, index) => {
    const span = tree[rootSpan.span_id];
    if (span) {
      buildAsciiTree(span, "", index === rootSpans.length - 1);
    }
  });

  return result;
};

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

  const traceId = req.query.id as string;

  const traceDetails = await getTraceById({
    projectId: project?.id,
    traceId,
  });

  const spans = Object.values(
    await getSpansForTraceIds(project?.id, [traceId])
  ).flat();

  // Generate ASCII tree representation
  const asciiTree = generateAsciiTree(spans);

  const evaluations = await getEvaluationsMultiple({
    projectId: project?.id,
    traceIds: [traceId],
  });
  const evaluations_ = Object.values(evaluations ?? {}).flatMap(
    (evaluationList) => {
      return elasticSearchEvaluationsToEvaluations(evaluationList);
    }
  );

  return res.status(200).json({
    ...traceDetails,
    spans,
    evaluations: evaluations_,
    asciiTree,
  });
}
