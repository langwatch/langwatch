import { type NextApiRequest, type NextApiResponse } from "next";
import { fromZodError, type ZodError } from "zod-validation-error";
import { prisma } from "../../../../server/db"; // Adjust the import based on your setup

import { getDebugger } from "../../../../utils/logger";

import { CostReferenceType, CostType, type Check } from "@prisma/client";
import { nanoid } from "nanoid";
import { z } from "zod";
import { env } from "../../../../env.mjs";
import { updateCheckStatusInES } from "../../../../server/background/queues/traceChecksQueue";
import { rAGChunkSchema } from "../../../../server/tracer/types.generated";
import type {
  BatchEvaluationResult,
  EvaluationResult,
  EvaluationResultError,
  EvaluationResultSkipped,
  EvaluatorTypes,
  SingleEvaluationResult,
} from "../../../../trace_checks/evaluators.generated";
import { evaluatorsSchema } from "../../../../trace_checks/evaluators.zod.generated";
import { getEvaluatorDefinitions } from "../../../../trace_checks/getEvaluator";
import { extractChunkTextualContent } from "../../collector/rag";
import * as Sentry from "@sentry/nextjs";

export const debug = getDebugger("langwatch:guardrail:evaluate");

export const guardrailInputSchema = z.object({
  trace_id: z.string().optional(),
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

export type GuardrailRESTParams = z.infer<typeof guardrailInputSchema>;

type GuardrailResult = (
  | EvaluationResult
  | EvaluationResultSkipped
  | Omit<EvaluationResultError, "traceback">
) & {
  passed: boolean;
};

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

  const guardrailSlug = req.query.guardrail as string;

  const guardrail = await prisma.check.findUnique({
    where: {
      projectId_slug: {
        projectId: project.id,
        slug: guardrailSlug,
      },
    },
  });

  if (!guardrail) {
    return res.status(404).json({ message: "Guardrail not found" });
  }

  let params: GuardrailRESTParams;
  try {
    params = guardrailInputSchema.parse(req.body);
  } catch (error) {
    debug(
      "Invalid guardrail received",
      error,
      JSON.stringify(req.body, null, "  "),
      { projectId: project.id }
    );
    Sentry.captureException(error, { extra: { projectId: project.id } });

    const validationError = fromZodError(error as ZodError);
    return res.status(400).json({ error: validationError.message });
  }

  const evaluatorSettingSchema =
    evaluatorsSchema.shape[guardrail.checkType as EvaluatorTypes].shape
      .settings;
  let settings: z.infer<typeof evaluatorSettingSchema> | undefined = {};
  try {
    if (params.settings) {
      settings = evaluatorSettingSchema.parse(params.settings);
    }
  } catch (error) {
    debug(
      "Invalid guardrail settings received",
      error,
      JSON.stringify(req.body, null, "  "),
      { projectId: project.id }
    );
    Sentry.captureException(error, { extra: { projectId: project.id } });

    const validationError = fromZodError(error as ZodError);
    return res.status(400).json({ error: validationError.message });
  }

  const evaluatorDefinition = getEvaluatorDefinitions(guardrail.checkType)!;
  for (const requiredField of evaluatorDefinition.requiredFields) {
    if (!params.data[requiredField]) {
      return res.status(400).json({
        error: `${requiredField} is required for ${evaluatorDefinition.name} guardrail`,
      });
    }
  }

  const { input, output, contexts, expected_output } = params.data;
  const contextList = contexts
    ?.map((context) => {
      if (typeof context === "string") {
        return context;
      } else {
        return extractChunkTextualContent(context.content);
      }
    })
    .filter((x) => x);

  let result: SingleEvaluationResult;
  try {
    result = await runEvaluation({
      guardrail,
      input: input ? input : undefined,
      output: output ? output : undefined,
      contexts: contextList,
      expected_output: expected_output ? expected_output : undefined,
      settings,
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
        costType: CostType.GUARDRAIL,
        costName: guardrail.name,
        referenceType: CostReferenceType.CHECK,
        referenceId: guardrail.id,
        amount: result.cost.amount,
        currency: result.cost.currency,
        extraInfo: {
          trace_id: params.trace_id,
        },
      },
    });
  }

  const guardrailResult: GuardrailResult =
    result.status === "error"
      ? {
          status: "error",
          error_type: "EVALUATOR_ERROR",
          message: result.message,
          passed: false,
        }
      : result.status === "skipped"
      ? {
          status: "skipped",
          details: result.details,
          passed: false,
        }
      : {
          ...result,
          passed: result.passed ?? true,
        };

  if (params.trace_id) {
    await updateCheckStatusInES({
      check: {
        id: guardrail.id,
        type: guardrail.checkType as EvaluatorTypes,
        name: guardrail.name,
      },
      trace: {
        trace_id: params.trace_id,
        project_id: project.id,
      },
      status: result.status,
      ...(result.status === "error"
        ? {
            error: {
              message: result.message,
              stack: result.traceback,
            },
          }
        : {}),
      ...(result.status === "processed"
        ? {
            score: result.score,
            passed: result.passed,
          }
        : {}),
      details: "details" in result ? result.details ?? "" : "",
    });
  }

  return res.status(200).json(guardrailResult);
}

const runEvaluation = async ({
  guardrail,
  input,
  output,
  contexts,
  expected_output,
  settings,
}: {
  guardrail: Check;
  input?: string;
  output?: string;
  contexts?: string[];
  expected_output?: string;
  settings?: Record<string, unknown>;
}) => {
  const response = await fetch(
    `${env.LANGEVALS_ENDPOINT}/${guardrail.checkType}/evaluate`,
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
