import { type NextApiRequest, type NextApiResponse } from "next";
import { fromZodError, type ZodError } from "zod-validation-error";
import { prisma } from "../../../../../server/db"; // Adjust the import based on your setup

import { getDebugger } from "../../../../../utils/logger";

import {
  CostReferenceType,
  CostType,
} from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { nanoid } from "nanoid";
import { type z } from "zod";
import { updateEvaluationStatusInES } from "../../../../../server/background/queues/evaluationsQueue";
import { evaluationNameAutoslug } from "../../../../../server/background/workers/collector/evaluations";
import {
  runEvaluation,
  type DataForEvaluation,
} from "../../../../../server/background/workers/evaluationsWorker";
import {
  type EvaluatorTypes,
  type SingleEvaluationResult,
} from "../../../../../server/evaluations/evaluators.generated";
import { evaluatorsSchema } from "../../../../../server/evaluations/evaluators.zod.generated";
import { getEvaluatorDefaultSettings } from "../../../../../server/evaluations/getEvaluator";
import {
  evaluationInputSchema,
  type EvaluationRESTParams,
  type EvaluationRESTResult,
} from "../../../../../server/evaluations/types";
import {
  getEvaluatorDataForParams,
  getEvaluatorIncludingCustom,
} from "../../../dataset/evaluate";

export const debug = getDebugger("langwatch:evaluations:evaluate");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  return handleEvaluatorCall(req, res, false);
}

export async function handleEvaluatorCall(
  req: NextApiRequest,
  res: NextApiResponse,
  as_guardrail: boolean
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

  const evaluatorSlug = [req.query.evaluator, req.query.subpath]
    .filter(Boolean)
    .join("/");
  let checkType: string;

  const storedEvaluator = await prisma.monitor.findUnique({
    where: {
      projectId_slug: {
        projectId: project.id,
        slug: evaluatorSlug,
      },
    },
  });

  if (storedEvaluator != null) {
    checkType = storedEvaluator.checkType;
  } else {
    checkType = evaluatorSlug;
  }

  const evaluatorDefinition = await getEvaluatorIncludingCustom(
    project.id,
    checkType as EvaluatorTypes
  );
  if (!evaluatorDefinition) {
    return res.status(404).json({
      error: `Evaluator not found: ${checkType}`,
    });
  }

  let params: EvaluationRESTParams;

  try {
    params = evaluationInputSchema.parse(req.body);
  } catch (error) {
    debug(
      "Invalid evaluation params received",
      error,
      JSON.stringify(req.body, null, "  "),
      { projectId: project.id }
    );

    const validationError = fromZodError(error as ZodError);
    Sentry.captureException(error, {
      extra: {
        projectId: project.id,
        body: req.body,
        validationError: validationError.message,
      },
    });
    return res.status(400).json({ error: validationError.message });
  }

  const isGuardrail = as_guardrail || params.as_guardrail;

  if (storedEvaluator && !storedEvaluator.enabled && !!isGuardrail) {
    return res.status(200).json({
      status: "skipped",
      details: `Guardrail is not enabled`,
      ...(isGuardrail ? { passed: true } : {}),
    });
  }

  const evaluatorSettingSchema = checkType.startsWith("custom/")
    ? undefined
    : evaluatorsSchema.shape[checkType as EvaluatorTypes]?.shape.settings;

  let settings:
    | z.infer<NonNullable<typeof evaluatorSettingSchema>>
    | undefined =
    (storedEvaluator?.parameters as z.infer<
      NonNullable<typeof evaluatorSettingSchema>
    >) ?? {};

  try {
    settings = evaluatorSettingSchema?.parse({
      ...getEvaluatorDefaultSettings(evaluatorDefinition),
      ...(storedEvaluator ? (storedEvaluator.parameters as object) : {}),
      ...(params.settings ? params.settings : {}),
    });
  } catch (error) {
    debug(
      "Invalid settings received for the evaluator",
      error,
      JSON.stringify(req.body, null, "  "),
      { projectId: project.id }
    );

    const validationError = fromZodError(error as ZodError);
    Sentry.captureException(error, {
      extra: {
        projectId: project.id,
        body: req.body,
        validationError: validationError.message,
      },
    });
    return res.status(400).json({
      error: `Invalid settings for ${checkType} evaluator: ${validationError.message}`,
    });
  }

  let data: DataForEvaluation;
  try {
    data = getEvaluatorDataForParams(
      checkType,
      params.data as Record<string, any>
    );
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

  for (const requiredField of evaluatorDefinition.requiredFields) {
    if (
      data.data[requiredField] === undefined ||
      data.data[requiredField] === null
    ) {
      return res.status(400).json({
        error: `${requiredField} is required for ${evaluatorDefinition.name} evaluator`,
      });
    }
  }

  let result: SingleEvaluationResult;

  const runEval = () =>
    runEvaluation({
      projectId: project.id,
      evaluatorType: checkType as EvaluatorTypes,
      data,
      settings,
    });

  try {
    result = await runEval();

    // Retry once in case of timeout error
    if (
      result.status === "error" &&
      result.details.toLowerCase().includes("timed out")
    ) {
      result = await runEval();
    }
  } catch (error) {
    Sentry.captureException(error, {
      extra: {
        projectId: project.id,
        body: req.body,
      },
    });
    debug("Error running evaluation", error);
    result = {
      status: "error",
      error_type: "INTERNAL_ERROR",
      details: "Internal error",
      traceback: [],
    };
  }

  if ("cost" in result && result.cost) {
    await prisma.cost.create({
      data: {
        id: `cost_${nanoid()}`,
        projectId: project.id,
        costType: isGuardrail ? CostType.GUARDRAIL : CostType.TRACE_CHECK,
        costName: storedEvaluator?.name ?? checkType,
        referenceType: CostReferenceType.CHECK,
        referenceId: storedEvaluator?.id ?? checkType,
        amount: result.cost.amount,
        currency: result.cost.currency,
        extraInfo: {
          trace_id: params.trace_id,
        },
      },
    });
  }

  const resultWithoutTraceback: EvaluationRESTResult =
    result.status === "error"
      ? {
          status: "error",
          error_type: "EVALUATOR_ERROR",
          details: result.details,
          ...(isGuardrail ? { passed: true } : {}), // We don't want to fail the check if the evaluator throws, becuase this is likely a bug in the evaluator
        }
      : result.status === "skipped"
      ? {
          status: "skipped",
          details: result.details,
          ...(isGuardrail ? { passed: true } : {}),
        }
      : {
          ...result,
          ...(isGuardrail ? { passed: result.passed ?? true } : {}),
        };

  if (params.trace_id) {
    await updateEvaluationStatusInES({
      check: {
        evaluation_id:
          storedEvaluator?.id ?? params.evaluation_id ?? `eval_${nanoid()}`,
        evaluator_id:
          storedEvaluator?.id ??
          params.evaluator_id ??
          evaluationNameAutoslug(params.name ?? checkType),
        type: checkType as EvaluatorTypes,
        name: storedEvaluator?.name ?? params.name ?? checkType,
      },
      trace: {
        trace_id: params.trace_id,
        project_id: project.id,
      },
      status: result.status,
      is_guardrail: isGuardrail ?? undefined,
      ...(result.status === "error"
        ? {
            error: {
              details: result.details,
              stack: result.traceback,
            },
          }
        : {}),
      ...(result.status === "processed"
        ? {
            score: result.score,
            passed: result.passed,
            label: result.label,
          }
        : {}),
      details: "details" in result ? result.details ?? "" : "",
    });
  }

  return res.status(200).json(resultWithoutTraceback);
}
