import { type NextApiRequest, type NextApiResponse } from "next";
import { fromZodError, type ZodError } from "zod-validation-error";
import { prisma } from "../../../server/db"; // Adjust the import based on your setup

import { getDebugger } from "../../../utils/logger";

import { CostReferenceType, CostType } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { nanoid } from "nanoid";
import { z } from "zod";
import { env } from "../../../env.mjs";
import { rAGChunkSchema } from "../../../server/tracer/types.generated";
import {
  type BatchEvaluationResult,
  type EvaluationResult,
  type EvaluationResultError,
  type EvaluationResultSkipped,
  type SingleEvaluationResult,
  AVAILABLE_EVALUATORS,
} from "../../../trace_checks/evaluators.generated";
import { extractChunkTextualContent } from "../collector/rag";
import { c } from "vitest/dist/reporters-5f784f42";

export const debug = getDebugger("langwatch:guardrail:evaluate");

export const evaluationInputSchema = z.object({
  evaluation: z.string(),
  batchId: z.string(),
  datasetSlug: z.string(),
  data: z.object({
    input: z.string().optional().nullable(),
    output: z.string().optional().nullable(),
    contexts: z
      .union([z.array(rAGChunkSchema), z.array(z.string())])
      .optional()
      .nullable(),
    expected_output: z.string().optional().nullable(),
  }),
  settings: z.object({}).passthrough().optional().nullable(),
});

export type EvaluationRESTParams = z.infer<typeof evaluationInputSchema>;

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
  });

  if (!project) {
    return res.status(401).json({ message: "Invalid auth token." });
  }

  if (!req.body) {
    return res.status(400).json({ message: "Bad request" });
  }

  let params: EvaluationRESTParams;
  try {
    params = evaluationInputSchema.parse(req.body);
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

  const { input, output, contexts, expected_output } = params.data;
  const { batchId, datasetSlug } = params;
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
      error: `Invalid evaluation type: ${checkType}`,
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
      input: input ? input : undefined,
      output: output ? output : undefined,
      contexts: contextList,
      expected_output: expected_output ? expected_output : undefined,
      evaluation: checkType,
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

  if ("cost" in result && result.cost) {
    await prisma.cost.create({
      data: {
        id: `cost_${nanoid()}`,
        projectId: project.id,
        costType: CostType.BATCH_PROCESSING,
        costName: evaluation,
        referenceType: CostReferenceType.BATCH,
        referenceId: params.batchId,
        amount: result.cost.amount,
        currency: result.cost.currency,
      },
    });
  }

  if (result.status != "error") {
    const { score, passed, details, cost, status } = result as EvaluationResult;
    await prisma.batchProcessing.create({
      data: {
        id: nanoid(),
        batchId: batchId,
        projectId: project.id,
        status: status,
        score: score ?? 0,
        passed: passed ?? false,
        details: details ?? "",
        cost: cost?.amount ?? 0,
        evaluation: evaluation,
        datasetSlug: datasetSlug,
        datasetId: dataset.id,
      },
    });
  }

  return res.status(200).json(result);
}

const runEvaluation = async ({
  input,
  output,
  contexts,
  expected_output,
  evaluation,
  settings,
}: {
  input?: string;
  output?: string;
  contexts?: string[];
  expected_output?: string;
  evaluation: string;
  settings?: Record<string, unknown>;
}) => {
  const response = await fetch(
    `${env.LANGEVALS_ENDPOINT}/${evaluation}/evaluate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: [
          {
            input,
            output,
            contexts,
            expected_output,
          },
        ],

        settings: settings && typeof settings === "object" ? settings : {},
      }),
    }
  );

  const result = ((await response.json()) as BatchEvaluationResult)[0];
  if (!result) {
    throw "Unexpected response: empty results";
  }

  return result;
};
