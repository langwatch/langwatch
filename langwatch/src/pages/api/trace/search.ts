import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { fromZodError, type ZodError } from "zod-validation-error";
import { getAllForProjectInput } from "../../../server/api/routers/traces";
import { getProtectionsForProject } from "../../../server/api/utils";
import { prisma } from "../../../server/db";
import type { LLMModeTrace, Span, Trace } from "../../../server/tracer/types";
import { TraceService } from "../../../server/traces/trace.service";
import { toLLMModeTrace } from "~/server/traces/trace-formatting";
import { formatSpansDigest } from "~/server/tracer/spanToReadableSpan";

export const config = {
  api: {
    responseLimit: false,
  },
};

const paramsSchema = getAllForProjectInput
  .omit({
    projectId: true,
    startDate: true,
    endDate: true,
  })
  .extend({
    startDate: z.union([
      z.number(),
      z.string().refine((val) => !Number.isNaN(Date.parse(val)), {
        message: "Invalid date format for startDate",
      }),
    ]),
    endDate: z.union([
      z.number(),
      z.string().refine((val) => !Number.isNaN(Date.parse(val)), {
        message: "Invalid date format for endDate",
      }),
    ]),
    scrollId: z.string().optional().nullable(),
    format: z.enum(["digest", "json"]).optional(),
    llmMode: z.boolean().optional().default(false),
  });

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
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

  let params: z.infer<typeof paramsSchema>;
  try {
    params = paramsSchema.strict().parse(req.body);
  } catch (error) {
    const validationError = fromZodError(error as ZodError);
    return res.status(400).json({ error: validationError.message });
  }

  const format = params.format ?? (params.llmMode ? "digest" : "json");

  // Signal deprecation — consumers should migrate to /api/traces/search
  res.setHeader("Deprecation", "true");
  res.setHeader("Link", `</api/traces/search>; rel="successor-version"`);

  const pageSize = Math.min(params.pageSize ?? 1000, 1000);
  const protections = await getProtectionsForProject(prisma, {
    projectId: project.id,
  });
  const traceService = TraceService.create(prisma);
  const results = await traceService.getAllTracesForProject(
    {
      ...params,
      projectId: project.id,
      startDate:
        typeof params.startDate === "string"
          ? Date.parse(params.startDate)
          : params.startDate,
      endDate:
        typeof params.endDate === "string"
          ? Date.parse(params.endDate)
          : params.endDate,
      pageSize,
    },
    protections,
    {
      downloadMode: true,
      includeSpans: format === "digest",
      scrollId: params.scrollId ?? undefined,
    },
  );

  const rawTraces = results.groups.flat() as (Trace & { spans?: Span[] })[];

  let traces: unknown[];
  if (format === "digest") {
    traces = await Promise.all(rawTraces.map(async (trace) => ({
      trace_id: trace.trace_id,
      formatted_trace: await formatSpansDigest(trace.spans ?? []),
      input: trace.input,
      output: trace.output,
      timestamps: trace.timestamps,
      metadata: trace.metadata,
      error: trace.error,
    })));
  } else if (params.llmMode) {
    // Legacy llmMode behavior (kept for backward compat, but format=digest is preferred)
    traces = (rawTraces as Trace[]).map((trace) => ({
      ...toLLMModeTrace(trace as Trace & { spans: Span[] }),
      spans: [],
      evaluations: undefined,
    }));
  } else {
    traces = rawTraces;
  }

  return res.status(200).json({
    traces,
    pagination: {
      totalHits: results.totalHits,
      scrollId: results.scrollId,
    },
  });
}
