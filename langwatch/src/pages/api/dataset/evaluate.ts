import { type NextApiRequest, type NextApiResponse } from "next";
import { fromZodError, type ZodError } from "zod-validation-error";
import { prisma } from "../../../server/db";

import { getDebugger } from "../../../utils/logger";

import { CostReferenceType, CostType } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  getCurrentMonthCost,
  maxMonthlyUsageLimit,
} from "../../../server/api/routers/limits";
import { runEvaluation } from "../../../server/background/workers/evaluationsWorker";
import { rAGChunkSchema } from "../../../server/tracer/types.generated";
import {
  AVAILABLE_EVALUATORS,
  type EvaluationResult,
  type EvaluatorTypes,
  type SingleEvaluationResult,
} from "../../../server/evaluations/evaluators.generated";
import { extractChunkTextualContent } from "../../../server/background/workers/collector/rag";

export const debug = getDebugger("langwatch:guardrail:evaluate");

const batchEvaluationInputSchema = z.object({
  evaluation: z.string(),
  experimentSlug: z.string().optional(),
  batchId: z.string().optional(),
  datasetSlug: z.string(),
  data: z.object({
    input: z.string().optional().nullable(),
    output: z.string().optional().nullable(),
    contexts: z
      .union([z.array(rAGChunkSchema), z.array(z.string())])
      .optional()
      .nullable(),
    expected_output: z.string().optional().nullable(),
    conversation: z
      .array(
        z.object({
          input: z.string().optional().nullable(),
          output: z.string().optional().nullable(),
        })
      )
      .optional()
      .nullable(),
  }),
  settings: z.object({}).passthrough().optional().nullable(),
});

type BatchEvaluationRESTParams = z.infer<typeof batchEvaluationInputSchema>;

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
    include: { team: true },
  });

  if (!project) {
    return res.status(401).json({ message: "Invalid auth token." });
  }

  if (!req.body) {
    return res.status(400).json({ message: "Bad request" });
  }

  let params: BatchEvaluationRESTParams;
  try {
    params = batchEvaluationInputSchema.parse(req.body);
  } catch (error) {
    debug(
      "Invalid evaluation data received",
      error,
      JSON.stringify(req.body, null, "  "),
      { projectId: project.id }
    );
    Sentry.captureException(error, { extra: { projectId: project.id } });

    const validationError = fromZodError(error as ZodError);
    return res.status(400).json({ error: validationError.message });
  }

  const maxMonthlyUsage = await maxMonthlyUsageLimit(
    project.team.organizationId
  );
  const getCurrentCost = await getCurrentMonthCost(project.team.organizationId);

  if (getCurrentCost >= maxMonthlyUsage) {
    return res.status(200).json({
      status: "skipped",
      details: "Monthly usage limit exceeded",
    });
  }

  const { input, output, contexts, expected_output, conversation } =
    params.data;
  const { datasetSlug } = params;
  const experimentSlug = params.experimentSlug ?? params.batchId ?? nanoid(); // backwards compatibility
  const evaluation = params.evaluation;
  let settings = null;
  let checkType;

  const check = await prisma.check.findFirst({
    where: {
      projectId: project.id,
      slug: evaluation,
    },
  });

  if (check != null) {
    checkType = check.checkType;
    settings = check.parameters;
  } else {
    checkType = evaluation;
  }

  if (!AVAILABLE_EVALUATORS[checkType as keyof typeof AVAILABLE_EVALUATORS]) {
    return res.status(400).json({
      error: `Evaluator not found: ${checkType}`,
    });
  }

  const evaluationRequiredFields =
    AVAILABLE_EVALUATORS[checkType as keyof typeof AVAILABLE_EVALUATORS]
      .requiredFields;

  if (
    !evaluationRequiredFields.every((field: string) => {
      return field in params.data;
    })
  ) {
    return res.status(400).json({
      error: `Missing required field for ${checkType}`,
      requiredFields: evaluationRequiredFields,
    });
  }

  const contextList = contexts
    ?.map((context) => {
      if (typeof context === "string") {
        return context;
      } else {
        return extractChunkTextualContent(context.content);
      }
    })
    .filter((x) => x);

  const dataset = await prisma.dataset.findFirst({
    where: {
      slug: datasetSlug,
      projectId: project.id,
    },
  });

  if (!dataset) {
    return res.status(404).json({ error: "Dataset not found" });
  }

  let result: SingleEvaluationResult;
  try {
    result = await runEvaluation({
      projectId: project.id,
      input: input ? input : undefined,
      output: output ? output : undefined,
      contexts: contextList,
      expected_output: expected_output ? expected_output : undefined,
      conversation:
        conversation?.map((message) => ({
          input: message.input ?? undefined,
          output: message.output ?? undefined,
        })) ?? [],
      checkType: checkType as EvaluatorTypes,
      settings: (settings as Record<string, unknown>) ?? {},
    });
  } catch (error) {
    result = {
      status: "error",
      error_type: "INTERNAL_ERROR",
      message: "Internal error",
      traceback: [],
    };
  }

  const experiment = await prisma.experiment.findUnique({
    where: {
      projectId_slug: {
        projectId: project.id,
        slug: experimentSlug,
      },
    },
  });

  if (!experiment) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Experiment not found" });
  }

  if ("cost" in result && result.cost) {
    await prisma.cost.create({
      data: {
        id: `cost_${nanoid()}`,
        projectId: project.id,
        costType: CostType.BATCH_EVALUATION,
        costName: evaluation,
        referenceType: CostReferenceType.BATCH,
        referenceId: experiment.id,
        amount: result.cost.amount,
        currency: result.cost.currency,
      },
    });
  }

  const { score, passed, details, cost, status, label } =
    result as EvaluationResult;

  await prisma.batchEvaluation.create({
    data: {
      id: nanoid(),
      experimentId: experiment.id,
      projectId: project.id,
      data: params.data,
      status: status,
      score: score ?? 0,
      passed: passed ?? false,
      label: label,
      details: details ?? "",
      cost: cost?.amount ?? 0,
      evaluation: evaluation,
      datasetSlug: datasetSlug,
      datasetId: dataset.id,
    },
  });

  return res.status(200).json(result);
}
