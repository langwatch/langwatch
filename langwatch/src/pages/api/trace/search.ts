import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "../../../server/db";

import { z } from "zod";
import { fromZodError, type ZodError } from "zod-validation-error";
import {
  getAllForProjectInput,
  getAllTracesForProject,
} from "../../../server/api/routers/traces";
import type { LLMModeTrace, Span, Trace } from "../../../server/tracer/types";
import { toLLMModeTrace } from "./[id]";

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
      z.string().refine((val) => !isNaN(Date.parse(val)), {
        message: "Invalid date format for startDate",
      }),
    ]),
    endDate: z.union([
      z.number(),
      z.string().refine((val) => !isNaN(Date.parse(val)), {
        message: "Invalid date format for endDate",
      }),
    ]),
    scrollId: z.string().optional().nullable(),
    llmMode: z.boolean().optional().default(false),
  });

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

  let params: z.infer<typeof paramsSchema>;
  try {
    params = paramsSchema.strict().parse(req.body);
  } catch (error) {
    const validationError = fromZodError(error as ZodError);
    return res.status(400).json({ error: validationError.message });
  }

  const pageSize = Math.min(params.pageSize ?? 1000, 1000);
  const results = await getAllTracesForProject({
    input: {
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
    ctx: {
      prisma,
      publiclyShared: false,

      // We don't care about user level permissions here, as we're access the data via API key
      session: null,
    },
    downloadMode: !params.llmMode,
    scrollId: params.scrollId ?? undefined,
  });
  let traces: (Trace | LLMModeTrace)[] = results.groups.flat();

  if (params.llmMode) {
    const llmModeTraces: LLMModeTrace[] = (traces as Trace[]).map((trace) => ({
      ...toLLMModeTrace(trace as Trace & { spans: Span[] }),
      spans: [],
      evaluations: undefined,
    }));
    traces = llmModeTraces;
  }

  return res.status(200).json({
    traces,
    pagination: {
      totalHits: results.totalHits,
      scrollId: results.scrollId,
    },
  });
}
