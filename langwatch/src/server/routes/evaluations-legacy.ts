/**
 * Hono routes for legacy evaluation endpoints.
 *
 * Replaces:
 * - src/pages/api/evaluations/list.ts
 * - src/pages/api/evaluations/[evaluator]/evaluate.ts
 * - src/pages/api/evaluations/[evaluator]/[subpath]/evaluate.ts
 * - src/pages/api/evaluations/batch/log_results.ts
 * - src/pages/api/guardrails/[evaluator]/evaluate.ts
 * - src/pages/api/dataset/evaluate.ts
 */
import type { Context } from "hono";
import { generate } from "@langwatch/ksuid";
import { CostReferenceType, CostType, ExperimentType } from "@prisma/client";
import type { Project } from "@prisma/client";
import type { JsonArray } from "@prisma/client/runtime/library";
import { TRPCError } from "@trpc/server";
import type { Edge, Node } from "@xyflow/react";
import { nanoid } from "nanoid";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { type ZodError, ZodError as ZodErrorClass, z } from "zod";
import { fromZodError } from "zod-validation-error";
import { zodToJsonSchema } from "zod-to-json-schema";
import { KSUID_RESOURCES } from "~/utils/constants";
import { captureException } from "~/utils/posthogErrorCapture";
import { mapZodIssuesToLogContext } from "~/utils/zod";
import { getInputsOutputs } from "~/optimization_studio/utils/nodeUtils";
import type { Workflow } from "~/optimization_studio/types/dsl";
import { getWorkflowEntryOutputs } from "~/optimization_studio/utils/workflowFields";
import { evaluatorTempNameMap } from "~/components/checks/EvaluatorSelection";
import { getCustomEvaluators } from "~/server/api/routers/evaluations";
import { getApp } from "~/server/app-layer/app";
import { DomainError } from "~/server/app-layer/domain-error";
import { evaluationNameAutoslug } from "~/server/background/workers/collector/evaluationNameAutoslug";
import { extractChunkTextualContent } from "~/server/background/workers/collector/rag";
import {
  type DataForEvaluation,
  runEvaluation,
} from "~/server/background/workers/evaluationsWorker";
import { prisma } from "~/server/db";
import {
  AVAILABLE_EVALUATORS,
  type EvaluationResult,
  type EvaluatorDefinition,
  type EvaluatorTypes,
  type SingleEvaluationResult,
} from "~/server/evaluations/evaluators.generated";
import { evaluatorsSchema } from "~/server/evaluations/evaluators.generated";
import { getEvaluatorDefaultSettings } from "~/server/evaluations/getEvaluator";
import {
  type EvaluationRESTParams,
  type EvaluationRESTResult,
  evaluationInputSchema,
} from "~/server/evaluations/types";
import { mapEsTargetsToTargets } from "~/server/evaluations-v3/services/mappers";
import {
  type ESBatchEvaluation,
  type ESBatchEvaluationRESTParams,
  type ESBatchEvaluationTarget,
  type ESBatchEvaluationTargetType,
  eSBatchEvaluationRESTParamsSchema,
  eSBatchEvaluationSchema,
  eSBatchEvaluationTargetTypeSchema,
} from "~/server/experiments/types";
import { getPayloadSizeHistogram } from "~/server/metrics";
import { rAGChunkSchema } from "~/server/tracer/types";
import { createLogger } from "~/utils/logger/server";
import { findOrCreateExperiment } from "~/pages/api/experiment/init";

const logger = createLogger("langwatch:evaluations-legacy");

export const app = new Hono().basePath("/api");

// ---------- GET /api/evaluations/list ----------
app.get("/evaluations/list", async (c) => {
  const evaluators = Object.fromEntries(
    Object.entries(AVAILABLE_EVALUATORS)
      .filter(
        ([key]) =>
          !key.startsWith("example/") &&
          key !== "aws/comprehend_pii_detection" &&
          key !== "google_cloud/dlp_pii_detection",
      )
      .map(([key, value]) => [
        key,
        {
          ...value,
          name: evaluatorTempNameMap[value.name] ?? value.name,
          settings_json_schema: zodToJsonSchema(
            // @ts-ignore
            evaluatorsSchema.shape[key].shape.settings,
          ),
        },
      ]),
  );

  return c.json({ evaluators });
});

// ---------- POST /api/evaluations/batch/log_results ----------
app.post(
  "/evaluations/batch/log_results",
  bodyLimit({ maxSize: 20 * 1024 * 1024 }),
  async (c) => {
    const xAuthToken = c.req.header("x-auth-token");
    const authHeader = c.req.header("authorization");

    const authToken =
      xAuthToken ??
      (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);

    if (!authToken) {
      return c.json(
        {
          message:
            "Authentication token is required. Use X-Auth-Token header or Authorization: Bearer token.",
        },
        401,
      );
    }

    const contentType = c.req.header("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      logger.warn(
        {
          contentType,
        },
        "log_results request body is not json",
      );
      return c.json({ message: "Invalid body, expecting json" }, 400);
    }

    const project = await prisma.project.findUnique({
      where: { apiKey: authToken },
    });

    if (!project) {
      return c.json({ message: "Invalid auth token." }, 401);
    }

    let body: Record<string, any>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ message: "Invalid body, expecting json" }, 400);
    }

    getPayloadSizeHistogram("log_results").observe(
      JSON.stringify(body).length,
    );

    let params: ESBatchEvaluationRESTParams;
    try {
      params = eSBatchEvaluationRESTParamsSchema.parse(body);
    } catch (error) {
      logger.error(
        { error, body, projectId: project.id },
        "invalid log_results data received",
      );
      captureException(error, { extra: { projectId: project.id } });
      const validationError = fromZodError(error as ZodError);
      return c.json({ error: validationError.message }, 400);
    }

    if (!params.experiment_id && !params.experiment_slug) {
      logger.warn(
        { runId: params.run_id },
        "log_results missing experiment_id and experiment_slug",
      );
      return c.json(
        { error: "Either experiment_id or experiment_slug is required" },
        400,
      );
    }

    if (
      params.timestamps?.created_at &&
      params.timestamps.created_at.toString().length === 10
    ) {
      return c.json(
        {
          error:
            "Timestamps should be in milliseconds not in seconds, please multiply it by 1000",
        },
        400,
      );
    }

    try {
      await processBatchEvaluation(project, params);
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.error(
          { error, body: params, projectId: project.id },
          "failed to validate data for batch evaluation",
        );
        captureException(error, {
          extra: { projectId: project.id, param: params },
        });
        const validationError = fromZodError(error);
        return c.json({ error: validationError.message }, 400);
      } else if (DomainError.is(error)) {
        logger.warn(
          { kind: error.kind, meta: error.meta, projectId: project.id },
          "domain error processing batch evaluation",
        );
        return c.json(
          { error: error.kind, message: error.message },
          error.httpStatus as 400,
        );
      } else {
        logger.error(
          { error, body: params, projectId: project.id },
          "internal server error processing batch evaluation",
        );
        captureException(error, {
          extra: { projectId: project.id, param: params },
        });
        return c.json(
          {
            error:
              error instanceof Error ? error.message : "Internal server error",
          },
          500,
        );
      }
    }

    return c.json({ message: "ok" });
  },
);

// ---------- POST /api/evaluations/:evaluator/evaluate ----------
app.post(
  "/evaluations/:evaluator/evaluate",
  bodyLimit({ maxSize: 30 * 1024 * 1024 }),
  async (c) => {
    const evaluatorSlug = c.req.param("evaluator");
    return handleEvaluatorCall(c, evaluatorSlug, false);
  },
);

// ---------- POST /api/evaluations/:evaluator/:subpath/evaluate ----------
app.post(
  "/evaluations/:evaluator/:subpath/evaluate",
  bodyLimit({ maxSize: 30 * 1024 * 1024 }),
  async (c) => {
    const evaluatorSlug = `${c.req.param("evaluator")}/${c.req.param("subpath")}`;
    return handleEvaluatorCall(c, evaluatorSlug, false);
  },
);

// ---------- POST /api/guardrails/:evaluator/evaluate ----------
app.post(
  "/guardrails/:evaluator/evaluate",
  bodyLimit({ maxSize: 30 * 1024 * 1024 }),
  async (c) => {
    const evaluatorSlug = c.req.param("evaluator");
    return handleEvaluatorCall(c, evaluatorSlug, true);
  },
);

// ---------- POST /api/dataset/evaluate ----------
app.post("/dataset/evaluate", async (c) => {
  const authToken = c.req.header("x-auth-token");
  if (!authToken) {
    return c.json({ message: "X-Auth-Token header is required." }, 401);
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken },
    include: { team: true },
  });
  if (!project) {
    return c.json({ message: "Invalid auth token." }, 401);
  }

  let body: Record<string, any>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ message: "Bad request" }, 400);
  }

  let params: BatchEvaluationRESTParams;
  try {
    params = batchEvaluationInputSchema.parse(body);
  } catch (error) {
    logger.error(
      { error, body, projectId: project.id },
      "invalid evaluation params received",
    );
    captureException(error, { extra: { projectId: project.id } });
    const validationError = fromZodError(error as ZodError);
    return c.json({ error: validationError.message }, 400);
  }

  const { datasetSlug } = params;
  const experimentSlug =
    params.experimentSlug ?? params.batchId ?? nanoid();
  const evaluation = params.evaluation;
  let settings = null;
  let checkType;

  const check = await prisma.monitor.findFirst({
    where: { projectId: project.id, slug: evaluation },
  });

  if (check != null) {
    checkType = check.checkType;
    settings = check.parameters;
  } else {
    checkType = evaluation;
  }

  const evaluator = await getEvaluatorIncludingCustom(
    project.id,
    checkType as EvaluatorTypes,
  );
  if (!evaluator) {
    return c.json({ error: `Evaluator not found: ${checkType}` }, 400);
  }

  let data: DataForEvaluation;
  try {
    data = getEvaluatorDataForParams(
      checkType,
      params.data as Record<string, any>,
    );
    if (
      !evaluator.requiredFields.every(
        (field: string) => field in data.data,
      )
    ) {
      return c.json(
        {
          error: `Missing required field for ${checkType}`,
          requiredFields: evaluator.requiredFields,
        },
        400,
      );
    }
  } catch (error) {
    logger.error(
      { error, body, projectId: project.id },
      "invalid evaluation data received",
    );
    captureException(error, { extra: { projectId: project.id } });
    const validationError = fromZodError(error as ZodError);
    return c.json({ error: validationError.message }, 400);
  }

  const dataset = await prisma.dataset.findFirst({
    where: { slug: datasetSlug, projectId: project.id },
  });
  if (!dataset) {
    return c.json({ error: "Dataset not found" }, 404);
  }

  let result: SingleEvaluationResult;
  try {
    result = await runEvaluation({
      projectId: project.id,
      data,
      evaluatorType: checkType as EvaluatorTypes,
      settings: (settings as Record<string, unknown>) ?? {},
    });
  } catch (error) {
    result = {
      status: "error",
      error_type: "INTERNAL_ERROR",
      details: error instanceof Error ? error.message : "Internal error",
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
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Experiment not found",
    });
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
      data: data.data,
      status,
      score: score ?? 0,
      passed: passed ?? false,
      label,
      details: details ?? "",
      cost: cost?.amount ?? 0,
      evaluation,
      datasetSlug,
      datasetId: dataset.id,
    },
  });

  return c.json(result);
});

// ============ Shared helpers ============

const batchEvaluationInputSchema = z.object({
  evaluation: z.string(),
  experimentSlug: z.string().optional(),
  batchId: z.string().optional(),
  datasetSlug: z.string(),
  data: z.object({}).passthrough().optional().nullable(),
  settings: z.object({}).passthrough().optional().nullable(),
});

type BatchEvaluationRESTParams = z.infer<typeof batchEvaluationInputSchema>;

const defaultEvaluatorInputSchema = z.object({
  input: z.string().optional().nullable(),
  output: z.string().optional().nullable(),
  contexts: z
    .union([z.array(rAGChunkSchema), z.array(z.string())])
    .optional()
    .nullable(),
  expected_output: z.string().optional().nullable(),
  expected_contexts: z
    .union([z.array(rAGChunkSchema), z.array(z.string())])
    .optional()
    .nullable(),
  conversation: z
    .array(
      z.object({
        input: z.string().optional().nullable(),
        output: z.string().optional().nullable(),
      }),
    )
    .optional()
    .nullable(),
});

const autoparseContexts = (
  contexts: unknown[] | unknown,
): string[] | undefined => {
  if (contexts === null || contexts === undefined) return undefined;
  const parsedContexts = Array.isArray(contexts) ? contexts : [contexts];
  return parsedContexts.map((context) => {
    if (typeof context === "string") return context;
    return extractChunkTextualContent(
      "content" in context ? context.content : context,
    );
  });
};

export const getEvaluatorDataForParams = (
  checkType: string,
  params: Record<string, any>,
): DataForEvaluation => {
  if (checkType.startsWith("custom/")) {
    return { type: "custom", data: params };
  }

  const data_ = defaultEvaluatorInputSchema.parse({
    ...params,
    contexts: autoparseContexts(params.contexts),
    expected_contexts: autoparseContexts(params.expected_contexts),
  });

  return {
    type: "default",
    data: {
      input: data_.input ? data_.input : undefined,
      output: data_.output ? data_.output : undefined,
      contexts: JSON.stringify(data_.contexts),
      expected_output: data_.expected_output
        ? data_.expected_output
        : undefined,
      expected_contexts: JSON.stringify(data_.expected_contexts),
      conversation: JSON.stringify(
        data_.conversation?.map((message) => ({
          input: message.input ?? undefined,
          output: message.output ?? undefined,
        })) ?? [],
      ),
    },
  };
};

export const getEvaluatorIncludingCustom = async (
  projectId: string,
  checkType: EvaluatorTypes,
): Promise<
  EvaluatorDefinition<keyof typeof AVAILABLE_EVALUATORS> | undefined
> => {
  const availableCustomEvaluators = await getCustomEvaluators({
    projectId,
  });

  const availableEvaluators = {
    ...AVAILABLE_EVALUATORS,
    ...Object.fromEntries(
      (availableCustomEvaluators ?? []).map((evaluator) => {
        const { inputs } = getInputsOutputs(
          JSON.parse(JSON.stringify(evaluator.versions[0]?.dsl))
            ?.edges as Edge[],
          JSON.parse(JSON.stringify(evaluator.versions[0]?.dsl))
            ?.nodes as JsonArray as unknown[] as Node[],
        );
        const requiredFields = inputs.map((input) => input.identifier);
        return [
          `custom/${evaluator.id}`,
          { name: evaluator.name, requiredFields },
        ];
      }),
    ),
  };

  return availableEvaluators[checkType];
};

// --- Evaluator call handler (used by evaluations + guardrails routes) ---

async function handleEvaluatorCall(
  c: Context,
  evaluatorSlug: string,
  as_guardrail: boolean,
) {
  const authToken = c.req.header("x-auth-token");
  if (!authToken) {
    return c.json({ message: "X-Auth-Token header is required." }, 401);
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken },
  });
  if (!project) {
    return c.json({ message: "Invalid auth token." }, 401);
  }

  let body: Record<string, any>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ message: "Bad request" }, 400);
  }

  let checkType: string;
  let evaluatorSettings: Record<string, unknown> | undefined;
  let evaluatorName: string | undefined;
  let savedEvaluatorId: string | undefined;
  let workflowEvaluatorDef:
    | { name: string; requiredFields: string[] }
    | undefined;

  if (evaluatorSlug.startsWith("evaluators/")) {
    const slugOrId = evaluatorSlug.replace("evaluators/", "");
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

      if (savedEvaluator.type === "workflow" && savedEvaluator.workflowId) {
        checkType = `custom/${savedEvaluator.workflowId}`;
        const workflow = await prisma.workflow.findUnique({
          where: { id: savedEvaluator.workflowId },
          include: { currentVersion: true },
        });
        if (!workflow) {
          return c.json(
            { error: `Workflow not found for evaluator: ${slugOrId}` },
            404,
          );
        }
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
      savedEvaluatorId = savedEvaluator.id;
    } else {
      return c.json(
        { error: `Evaluator not found with slug or id: ${slugOrId}` },
        404,
      );
    }
  } else {
    const monitor = await prisma.monitor.findUnique({
      where: {
        projectId_slug: { projectId: project.id, slug: evaluatorSlug },
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

  const monitor = !evaluatorSlug.startsWith("evaluators/")
    ? await prisma.monitor.findUnique({
        where: {
          projectId_slug: { projectId: project.id, slug: evaluatorSlug },
        },
      })
    : null;

  const evaluatorDefinition =
    workflowEvaluatorDef ??
    (await getEvaluatorIncludingCustom(
      project.id,
      checkType as EvaluatorTypes,
    ));
  if (!evaluatorDefinition) {
    return c.json({ error: `Evaluator not found: ${checkType}` }, 404);
  }

  let params: EvaluationRESTParams;
  try {
    params = evaluationInputSchema.parse(body);
  } catch (error) {
    const message =
      error instanceof ZodErrorClass
        ? fromZodError(error).message
        : error instanceof Error
          ? error.message
          : String(error);
    logger.error(
      {
        err: error,
        ...(error instanceof ZodErrorClass
          ? { zodIssues: mapZodIssuesToLogContext(error.issues) }
          : {}),
        projectId: project.id,
      },
      "invalid evaluation params received",
    );
    captureException(error, {
      extra: { projectId: project.id, validationError: message },
    });
    return c.json({ error: message }, 400);
  }

  const isGuardrail = as_guardrail || params.as_guardrail;

  if (monitor && !monitor.enabled && !!isGuardrail) {
    return c.json({
      status: "skipped",
      details: `Guardrail is not enabled`,
      ...(isGuardrail ? { passed: true } : {}),
    });
  }

  if (body.settings?.trace_id) {
    params.trace_id = body.settings.trace_id;
  }

  const evaluatorSettingSchema = checkType.startsWith("custom/")
    ? undefined
    : evaluatorsSchema.shape[checkType as EvaluatorTypes]?.shape.settings;

  let settings: any =
    ((evaluatorSettings ?? monitor?.parameters) as any) ?? {};

  try {
    settings = evaluatorSettingSchema?.parse({
      ...(!workflowEvaluatorDef
        ? getEvaluatorDefaultSettings(evaluatorDefinition as any)
        : {}),
      ...(evaluatorSettings ??
        (monitor ? (monitor.parameters as object) : {})),
      ...(params.settings ? params.settings : {}),
    });
  } catch (error) {
    const message =
      error instanceof ZodErrorClass
        ? fromZodError(error).message
        : error instanceof Error
          ? error.message
          : String(error);
    logger.error(
      {
        err: error,
        ...(error instanceof ZodErrorClass
          ? { zodIssues: mapZodIssuesToLogContext(error.issues) }
          : {}),
        projectId: project.id,
      },
      "invalid settings received for the evaluator",
    );
    captureException(error, {
      extra: { projectId: project.id, validationError: message },
    });
    return c.json(
      {
        error: `Invalid settings for ${checkType} evaluator: ${message}`,
      },
      400,
    );
  }

  let data: DataForEvaluation;
  try {
    data = getEvaluatorDataForParams(
      checkType,
      params.data as Record<string, any>,
    );
  } catch (error) {
    const message =
      error instanceof ZodErrorClass
        ? fromZodError(error).message
        : error instanceof Error
          ? error.message
          : String(error);
    logger.error(
      {
        err: error,
        ...(error instanceof ZodErrorClass
          ? { zodIssues: mapZodIssuesToLogContext(error.issues) }
          : {}),
        projectId: project.id,
      },
      "invalid evaluation data received",
    );
    captureException(error, {
      extra: { projectId: project.id, validationError: message },
    });
    return c.json({ error: message }, 400);
  }

  for (const requiredField of evaluatorDefinition.requiredFields) {
    if (
      data.data[requiredField] === undefined ||
      data.data[requiredField] === null
    ) {
      return c.json(
        {
          error: `${requiredField} is required for ${evaluatorDefinition.name} evaluator`,
        },
        400,
      );
    }
  }

  let result: SingleEvaluationResult;
  let costId: string | undefined;

  const evaluationId =
    params.evaluation_id ??
    generate(KSUID_RESOURCES.EVALUATION).toString();
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

  try {
    result = await runEval();

    if (
      result.status === "error" &&
      result.details.toLowerCase().includes("timed out")
    ) {
      result = await runEval();
    }

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
          extraInfo: { trace_id: params.trace_id },
        },
      });
      costId = cost.id;
    }
  } catch (error) {
    captureException(error, { extra: { projectId: project.id } });
    logger.error(
      { err: error, projectId: project.id },
      "error running evaluation",
    );
    result = {
      status: "error",
      error_type: "INTERNAL_ERROR",
      details: error instanceof Error ? error.message : "Internal error",
      traceback: [],
    };
  } finally {
    await getApp()
      .evaluations.reportEvaluation({
        tenantId: project.id,
        evaluationId,
        evaluatorId,
        evaluatorType: checkType!,
        evaluatorName:
          evaluatorName ?? monitor?.name ?? params.name ?? undefined,
        traceId: params.trace_id ?? undefined,
        isGuardrail: isGuardrail ?? undefined,
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
          extra: {
            projectId: project.id,
            evaluationId,
            event: "reported",
          },
        });
        logger.error(
          { err: eventError, projectId: project.id, evaluationId },
          "Failed to emit evaluation reported event",
        );
      });
  }

  const resultWithoutTraceback: EvaluationRESTResult =
    result!.status === "error"
      ? {
          status: "error",
          error_type: "EVALUATOR_ERROR",
          details: result!.details,
          ...(isGuardrail ? { passed: true } : {}),
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

  return c.json(resultWithoutTraceback);
}

// --- Batch evaluation processing ---

const VALID_TARGET_TYPES: ESBatchEvaluationTargetType[] = [
  "prompt",
  "agent",
  "custom",
];

const processTargets = (
  targets: ESBatchEvaluationRESTParams["targets"],
): ESBatchEvaluationTarget[] | null => {
  if (!targets || targets.length === 0) return null;

  return targets.map((target) => {
    let targetType: ESBatchEvaluationTargetType = target.type ?? "custom";
    let metadata = target.metadata;

    if (metadata && "type" in metadata) {
      const typeFromMetadata = metadata.type;
      if (typeof typeFromMetadata === "string") {
        const parseResult =
          eSBatchEvaluationTargetTypeSchema.safeParse(typeFromMetadata);
        if (parseResult.success) {
          targetType = parseResult.data;
          const { type: _, ...restMetadata } = metadata;
          metadata =
            Object.keys(restMetadata).length > 0 ? restMetadata : null;
        } else {
          throw new Error(
            `Invalid target type '${typeFromMetadata}'. Must be one of: ${VALID_TARGET_TYPES.join(", ")}`,
          );
        }
      }
    }

    return {
      id: target.id,
      name: target.name,
      type: targetType,
      prompt_id: target.prompt_id,
      prompt_version: target.prompt_version,
      agent_id: target.agent_id,
      model: target.model,
      metadata: metadata ?? null,
    };
  });
};

const processBatchEvaluation = async (
  project: Project,
  param: ESBatchEvaluationRESTParams,
) => {
  const { run_id, experiment_id, experiment_slug } = param;

  const experiment = await findOrCreateExperiment({
    project,
    experiment_id,
    experiment_slug,
    experiment_type: ExperimentType.BATCH_EVALUATION_V2,
    experiment_name: param.name ?? undefined,
    workflowId: param.workflow_id ?? undefined,
  });

  const processedTargets = processTargets(param.targets);

  const batchEvaluation: ESBatchEvaluation = {
    ...param,
    experiment_id: experiment.id,
    project_id: project.id,
    targets: processedTargets,
    dataset: param.dataset ?? [],
    evaluations: param.evaluations ?? [],
    timestamps: {
      ...param.timestamps,
      created_at: param.timestamps?.created_at ?? new Date().getTime(),
      inserted_at: new Date().getTime(),
      updated_at: new Date().getTime(),
    },
  };

  eSBatchEvaluationSchema.parse(batchEvaluation);

  await dispatchToClickHouse(project, experiment.id, batchEvaluation);
};

const dispatchToClickHouse = async (
  project: Project,
  experimentId: string,
  batchEvaluation: ESBatchEvaluation,
) => {
  const { run_id: runId } = batchEvaluation;
  const targets = mapEsTargetsToTargets(batchEvaluation.targets ?? []);

  try {
    await getApp().experimentRuns.startExperimentRun({
      tenantId: project.id,
      runId,
      experimentId,
      total: batchEvaluation.total || batchEvaluation.dataset.length,
      targets,
      occurredAt: Date.now(),
    });
  } catch (error) {
    logger.error(
      { error, runId, projectId: project.id },
      "Failed to dispatch startExperimentRun to CH",
    );
    throw error;
  }

  const resultPromises = [
    ...batchEvaluation.dataset.map((entry) =>
      getApp()
        .experimentRuns.recordTargetResult({
          tenantId: project.id,
          runId,
          experimentId,
          index: entry.index,
          targetId: entry.target_id ?? "",
          entry: entry.entry,
          predicted: entry.predicted ?? undefined,
          cost: entry.cost ?? undefined,
          duration: entry.duration ?? undefined,
          error: entry.error ?? undefined,
          traceId: entry.trace_id ?? undefined,
          targets,
          occurredAt: Date.now(),
        })
        .catch((err) => {
          logger.warn(
            {
              err,
              runId,
              index: entry.index,
              targetId: entry.target_id,
            },
            "Failed to dispatch recordTargetResult to CH",
          );
        }),
    ),
    ...batchEvaluation.evaluations.map((evaluation) =>
      getApp()
        .experimentRuns.recordEvaluatorResult({
          tenantId: project.id,
          runId,
          experimentId,
          index: evaluation.index,
          targetId: evaluation.target_id ?? "",
          evaluatorId: evaluation.evaluator,
          evaluatorName: evaluation.name ?? undefined,
          status: evaluation.status,
          score:
            typeof evaluation.score === "number"
              ? evaluation.score
              : undefined,
          label: evaluation.label ?? undefined,
          passed: evaluation.passed ?? undefined,
          details: evaluation.details ?? undefined,
          cost: evaluation.cost ?? undefined,
          inputs: evaluation.inputs ?? undefined,
          duration:
            typeof evaluation.duration === "number"
              ? evaluation.duration
              : undefined,
          occurredAt: Date.now(),
        })
        .catch((err) => {
          logger.warn(
            {
              err,
              runId,
              index: evaluation.index,
              evaluator: evaluation.evaluator,
            },
            "Failed to dispatch recordEvaluatorResult to CH",
          );
        }),
    ),
  ];
  await Promise.all(resultPromises);

  if (
    batchEvaluation.timestamps.finished_at ||
    batchEvaluation.timestamps.stopped_at
  ) {
    try {
      await getApp().experimentRuns.completeExperimentRun({
        tenantId: project.id,
        runId,
        experimentId,
        finishedAt: batchEvaluation.timestamps.finished_at ?? undefined,
        stoppedAt: batchEvaluation.timestamps.stopped_at ?? undefined,
        occurredAt: Date.now(),
      });
    } catch (error) {
      logger.warn(
        { error, runId, projectId: project.id },
        "Failed to dispatch completeExperimentRun to CH",
      );
    }
  }

  {
    const appInstance = getApp();
    const evalPromises = batchEvaluation.evaluations.map((evaluation) => {
      const targetId = evaluation.target_id ?? "";
      const evaluationId = `local_eval_${runId}_${evaluation.evaluator}_${evaluation.index}_${targetId}`;
      return appInstance.evaluations
        .reportEvaluation({
          tenantId: project.id,
          evaluationId,
          evaluatorId: evaluation.evaluator,
          evaluatorType: evaluation.evaluator,
          evaluatorName: evaluation.name ?? undefined,
          status: evaluation.status,
          score:
            typeof evaluation.score === "number"
              ? evaluation.score
              : undefined,
          passed: evaluation.passed ?? undefined,
          label: evaluation.label ?? undefined,
          details: evaluation.details ?? undefined,
          occurredAt: Date.now(),
        })
        .catch((err) => {
          logger.warn(
            { err, evaluationId, evaluator: evaluation.evaluator },
            "Failed to dispatch evaluation to evaluation processing pipeline",
          );
        });
    });
    await Promise.all(evalPromises);
  }
};
