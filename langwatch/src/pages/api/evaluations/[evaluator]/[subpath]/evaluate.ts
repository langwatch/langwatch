import { generate } from "@langwatch/ksuid";
import { CostReferenceType, CostType } from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";
import type { z } from "zod";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { KSUID_RESOURCES } from "~/utils/constants";
import { captureException } from "~/utils/posthogErrorCapture";
import { mapZodIssuesToLogContext } from "~/utils/zod";
import type { Workflow } from "../../../../../optimization_studio/types/dsl";
import { getWorkflowEntryOutputs } from "../../../../../optimization_studio/utils/workflowFields";
import { getApp } from "../../../../../server/app-layer/app";
import { updateEvaluationStatusInES } from "../../../../../server/background/queues/evaluationsQueue";
import { evaluationNameAutoslug } from "../../../../../server/background/workers/collector/evaluations";
import {
  type DataForEvaluation,
  runEvaluation,
} from "../../../../../server/background/workers/evaluationsWorker";
import { prisma } from "../../../../../server/db";
import type {
  EvaluatorTypes,
  SingleEvaluationResult,
} from "../../../../../server/evaluations/evaluators.generated";
import { evaluatorsSchema } from "../../../../../server/evaluations/evaluators.zod.generated";
import { getEvaluatorDefaultSettings } from "../../../../../server/evaluations/getEvaluator";
import {
  type EvaluationRESTParams,
  type EvaluationRESTResult,
  evaluationInputSchema,
} from "../../../../../server/evaluations/types";
import { createLogger } from "../../../../../utils/logger/server";
import {
  getEvaluatorDataForParams,
  getEvaluatorIncludingCustom,
} from "../../../dataset/evaluate";

const logger = createLogger("langwatch:evaluations:evaluate");

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "30mb",
    },
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  return handleEvaluatorCall(req, res, false);
}

export async function handleEvaluatorCall(
  req: NextApiRequest,
  res: NextApiResponse,
  as_guardrail: boolean,
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
  let evaluatorSettings: Record<string, unknown> | undefined;
  let evaluatorName: string | undefined;
  let savedEvaluatorId: string | undefined; // ID from Evaluator table when using evaluators/ path
  let workflowEvaluatorDef:
    | { name: string; requiredFields: string[] }
    | undefined; // For workflow evaluators from Evaluator table

  // Check if using the new evaluators/slug or evaluators/id format
  if (evaluatorSlug.startsWith("evaluators/")) {
    const slugOrId = evaluatorSlug.replace("evaluators/", "");
    // Try to find by slug first, then by id
    const savedEvaluator = await prisma.evaluator.findFirst({
      where: {
        projectId: project.id,
        OR: [{ slug: slugOrId }, { id: slugOrId }],
        archivedAt: null,
      },
    });

    if (savedEvaluator) {
      const config = savedEvaluator.config as {
        evaluatorType?: string;
        settings?: Record<string, unknown>;
      } | null;

      // For workflow evaluators, use the custom/{workflowId} format and look up the workflow directly
      if (savedEvaluator.type === "workflow" && savedEvaluator.workflowId) {
        checkType = `custom/${savedEvaluator.workflowId}`;

        // Look up the workflow directly to get required fields
        const workflow = await prisma.workflow.findUnique({
          where: { id: savedEvaluator.workflowId },
          include: { currentVersion: true },
        });

        if (!workflow) {
          return res.status(404).json({
            error: `Workflow not found for evaluator: ${slugOrId}`,
          });
        }

        // Build evaluator definition from workflow DSL
        const dsl = workflow.currentVersion?.dsl as unknown as
          | Workflow
          | undefined;
        const entryOutputs = dsl ? getWorkflowEntryOutputs(dsl) : [];
        workflowEvaluatorDef = {
          name: savedEvaluator.name,
          requiredFields: entryOutputs.map((o) => o.identifier),
        };
      } else {
        checkType = config?.evaluatorType ?? evaluatorSlug;
      }

      evaluatorSettings = config?.settings;
      evaluatorName = savedEvaluator.name;
      savedEvaluatorId = savedEvaluator.id; // Capture the evaluator ID
    } else {
      return res.status(404).json({
        error: `Evaluator not found with slug or id: ${slugOrId}`,
      });
    }
  } else {
    // Legacy: Look up by Monitor slug or treat as direct checkType
    const monitor = await prisma.monitor.findUnique({
      where: {
        projectId_slug: {
          projectId: project.id,
          slug: evaluatorSlug,
        },
      },
    });

    if (monitor != null) {
      checkType = monitor.checkType;
      evaluatorSettings = monitor.parameters as
        | Record<string, unknown>
        | undefined;
      evaluatorName = monitor.name;
    } else {
      checkType = evaluatorSlug;
    }
  }

  // For backward compatibility, keep monitor reference for enabled check
  const monitor = !evaluatorSlug.startsWith("evaluators/")
    ? await prisma.monitor.findUnique({
        where: {
          projectId_slug: {
            projectId: project.id,
            slug: evaluatorSlug,
          },
        },
      })
    : null;

  // Use pre-computed workflow evaluator definition, or look up from AVAILABLE_EVALUATORS/custom evaluators
  const evaluatorDefinition =
    workflowEvaluatorDef ??
    (await getEvaluatorIncludingCustom(
      project.id,
      checkType as EvaluatorTypes,
    ));
  if (!evaluatorDefinition) {
    return res.status(404).json({
      error: `Evaluator not found: ${checkType}`,
    });
  }

  let params: EvaluationRESTParams;

  try {
    params = evaluationInputSchema.parse(req.body);
  } catch (error) {
    const message =
      error instanceof ZodError
        ? fromZodError(error).message
        : error instanceof Error
          ? error.message
          : String(error);
    logger.error(
      {
        err: error,
        ...(error instanceof ZodError
          ? { zodIssues: mapZodIssuesToLogContext(error.issues) }
          : {}),
        projectId: project.id,
      },
      "invalid evaluation params received",
    );

    captureException(error, {
      extra: {
        projectId: project.id,
        validationError: message,
      },
    });
    return res.status(400).json({ error: message });
  }

  const isGuardrail = as_guardrail || params.as_guardrail;

  if (monitor && !monitor.enabled && !!isGuardrail) {
    return res.status(200).json({
      status: "skipped",
      details: `Guardrail is not enabled`,
      ...(isGuardrail ? { passed: true } : {}),
    });
  }

  if (req.body.settings?.trace_id) {
    params.trace_id = req.body.settings.trace_id;
  }

  const evaluatorSettingSchema = checkType.startsWith("custom/")
    ? undefined
    : evaluatorsSchema.shape[checkType as EvaluatorTypes]?.shape.settings;

  let settings:
    | z.infer<NonNullable<typeof evaluatorSettingSchema>>
    | undefined =
    ((evaluatorSettings ?? monitor?.parameters) as z.infer<
      NonNullable<typeof evaluatorSettingSchema>
    >) ?? {};

  try {
    // Only parse settings for built-in evaluators (workflowEvaluatorDef means it's a workflow evaluator)
    settings = evaluatorSettingSchema?.parse({
      // Default settings only apply to full evaluator definitions (not workflow evaluators)
      ...(!workflowEvaluatorDef
        ? getEvaluatorDefaultSettings(evaluatorDefinition as any)
        : {}),
      // Use evaluatorSettings from saved Evaluator, or fall back to monitor parameters
      ...(evaluatorSettings ?? (monitor ? (monitor.parameters as object) : {})),
      ...(params.settings ? params.settings : {}),
    });
  } catch (error) {
    const message =
      error instanceof ZodError
        ? fromZodError(error).message
        : error instanceof Error
          ? error.message
          : String(error);
    logger.error(
      {
        err: error,
        ...(error instanceof ZodError
          ? { zodIssues: mapZodIssuesToLogContext(error.issues) }
          : {}),
        projectId: project.id,
      },
      "invalid settings received for the evaluator",
    );

    captureException(error, {
      extra: {
        projectId: project.id,
        validationError: message,
      },
    });
    return res.status(400).json({
      error: `Invalid settings for ${checkType} evaluator: ${message}`,
    });
  }

  let data: DataForEvaluation;
  try {
    data = getEvaluatorDataForParams(
      checkType,
      params.data as Record<string, any>,
    );
  } catch (error) {
    const message =
      error instanceof ZodError
        ? fromZodError(error).message
        : error instanceof Error
          ? error.message
          : String(error);
    logger.error(
      {
        err: error,
        ...(error instanceof ZodError
          ? { zodIssues: mapZodIssuesToLogContext(error.issues) }
          : {}),
        projectId: project.id,
      },
      "invalid evaluation data received",
    );
    captureException(error, {
      extra: { projectId: project.id, validationError: message },
    });

    return res.status(400).json({ error: message });
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
  let costId: string | undefined;

  // Generate evaluationId for event sourcing tracking
  // evaluationId must be unique per execution (not per evaluator definition)
  // to avoid collapsing all executions into one aggregate stream
  const evaluationId =
    params.evaluation_id ?? generate(KSUID_RESOURCES.EVALUATION).toString();
  // evaluatorId identifies which evaluator definition is being used
  // Priority: savedEvaluatorId (from Evaluator table) > monitor > params > autoslug
  const evaluatorId =
    savedEvaluatorId ??
    monitor?.id ??
    params.evaluator_id ??
    evaluationNameAutoslug(params.name ?? checkType);

  const runEval = () =>
    runEvaluation({
      projectId: project.id,
      evaluatorType: checkType as EvaluatorTypes,
      data,
      settings,
    });

  // Emit evaluation started event
  // Note: Event sourcing errors are logged but not re-thrown because the evaluation
  // should proceed even if event tracking fails. Errors are captured for monitoring.
  if (project.featureEventSourcingEvaluationIngestion) {
    try {
      await getApp().evaluations.startEvaluation({
        tenantId: project.id,
        evaluationId,
        evaluatorId,
        evaluatorType: checkType,
        evaluatorName:
          evaluatorName ?? monitor?.name ?? params.name ?? undefined,
        traceId: params.trace_id ?? undefined,
        isGuardrail: isGuardrail ?? undefined,
        occurredAt: Date.now(),
      });
    } catch (eventError) {
      captureException(eventError, {
        extra: { projectId: project.id, evaluationId, event: "started" },
      });
      logger.error(
        {
          err: eventError,
          projectId: project.id,
          evaluationId,
        },
        "Failed to emit evaluation started event",
      );
    }
  }

  try {
    result = await runEval();

    // Retry once in case of timeout error
    if (
      result.status === "error" &&
      result.details.toLowerCase().includes("timed out")
    ) {
      result = await runEval();
    }

    // Create cost row before emitting completed event so costId is available
    if ("cost" in result && result.cost) {
      const cost = await prisma.cost.create({
        data: {
          id: generate(KSUID_RESOURCES.COST).toString(),
          projectId: project.id,
          costType: isGuardrail ? CostType.GUARDRAIL : CostType.TRACE_CHECK,
          costName: evaluatorName ?? monitor?.name ?? checkType,
          referenceType: CostReferenceType.CHECK,
          referenceId: evaluatorName ?? monitor?.id ?? checkType,
          amount: result.cost.amount,
          currency: result.cost.currency,
          extraInfo: {
            trace_id: params.trace_id,
          },
        },
      });
      costId = cost.id;
    }
  } catch (error) {
    captureException(error, {
      extra: {
        projectId: project.id,
      },
    });
    logger.error(
      {
        err: error,
        projectId: project.id,
      },
      "error running evaluation",
    );
    result = {
      status: "error",
      error_type: "INTERNAL_ERROR",
      details: error instanceof Error ? error.message : "Internal error",
      traceback: [],
    };
  } finally {
    // Emit evaluation completed event — always fires even if cost creation threw
    // Note: Event sourcing errors are logged but not re-thrown because the evaluation
    // result should be returned even if event tracking fails. Errors are captured for monitoring.
    if (project.featureEventSourcingEvaluationIngestion) {
      await getApp()
        .evaluations.completeEvaluation({
          tenantId: project.id,
          evaluationId,
          status: result!.status,
          score: "score" in result! ? result!.score : undefined,
          passed: "passed" in result! ? result!.passed : undefined,
          label: "label" in result! ? result!.label : undefined,
          details: "details" in result! ? result!.details : undefined,
          costId: costId ?? null,
          occurredAt: Date.now(),
          error:
            result!.status === "error"
              ? "details" in result!
                ? result!.details
                : undefined
              : undefined,
        })
        .catch((eventError: unknown) => {
          captureException(eventError, {
            extra: { projectId: project.id, evaluationId, event: "completed" },
          });
          logger.error(
            {
              err: eventError,
              projectId: project.id,
              evaluationId,
            },
            "Failed to emit evaluation completed event",
          );
        });
    }
  }

  const resultWithoutTraceback: EvaluationRESTResult =
    result!.status === "error"
      ? {
          status: "error",
          error_type: "EVALUATOR_ERROR",
          details: result!.details,
          ...(isGuardrail ? { passed: true } : {}), // We don't want to fail the check if the evaluator throws, becuase this is likely a bug in the evaluator
        }
      : result!.status === "skipped"
        ? {
            status: "skipped",
            details: result!.details,
            ...(isGuardrail ? { passed: true } : {}),
          }
        : {
            ...result!,
            ...(isGuardrail ? { passed: result!.passed ?? true } : {}),
          };

  if (params.trace_id && !project.featureEventSourcingEvaluationIngestion) {
    await updateEvaluationStatusInES({
      check: {
        evaluation_id: evaluationId,
        evaluator_id: evaluatorId,
        type: checkType as EvaluatorTypes,
        name: evaluatorName ?? monitor?.name ?? params.name ?? checkType,
      },
      trace: {
        trace_id: params.trace_id,
        project_id: project.id,
      },
      status: result!.status,
      is_guardrail: isGuardrail ?? undefined,
      ...(result!.status === "error"
        ? {
            error: {
              details: result!.details,
              stack: result!.traceback,
            },
          }
        : {}),
      ...(result!.status === "processed"
        ? {
            score: result!.score,
            passed: result!.passed,
            label: result!.label,
          }
        : {}),
      details: "details" in result! ? (result!.details ?? "") : "",
    });
  }

  return res.status(200).json(resultWithoutTraceback);
}
