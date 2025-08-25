import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute } from "hono-openapi";
import { zodToJsonSchema } from "zod-to-json-schema";
import { validator as zValidator, resolver } from "hono-openapi/zod";

import { type AuthMiddlewareVariables } from "../../middleware";
import { baseResponses } from "../../shared/base-responses";

import {
  evaluatorsResponseSchema,
  evaluationResultSchema,
  batchEvaluationResultSchema,
} from "./schemas/outputs";

import { AVAILABLE_EVALUATORS } from "~/server/evaluations/evaluators.generated";
import { evaluatorsSchema } from "~/server/evaluations/evaluators.zod.generated";
import { getEvaluatorDisplayName } from "~/server/evaluations/evaluator-names";
import { createLogger } from "~/utils/logger";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { type EvaluationServiceMiddlewareVariables } from "../middleware/evaluation-service";
import z from "zod";
import { batchEvaluationInputSchema, evaluationInputSchema } from "./schemas";

const logger = createLogger("langwatch:api:evaluations");

patchZodOpenapi();

// Define types for our Hono context variables
type Variables = AuthMiddlewareVariables & EvaluationServiceMiddlewareVariables;

// Define the Hono app
export const app = new Hono<{
  Variables: Variables;
}>();

// Get all available evaluators
app.get(
  "/",
  describeRoute({
    description: "Get all available evaluators",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(evaluatorsResponseSchema),
          },
        },
      },
    },
  }),
  async (c) => {
    const project = c.get("project");

    logger.info({ projectId: project.id }, "Getting all evaluators");

    const evaluators = Object.fromEntries(
      Object.entries(AVAILABLE_EVALUATORS)
        .filter(
          ([key, _evaluator]) =>
            !key.startsWith("example/") &&
            key !== "aws/comprehend_pii_detection" &&
            key !== "google_cloud/dlp_pii_detection"
        )
        .map(([key, value]) => [
          key,
          {
            ...value,
            name: getEvaluatorDisplayName(value.name),
            settings_json_schema: zodToJsonSchema(
              (evaluatorsSchema.shape as any)[key]?.shape?.settings ??
                z.object({})
            ),
          },
        ])
    );

    return c.json({ evaluators });
  }
);

// Evaluate with a specific evaluator
app.post(
  "/:evaluator{.+?}/evaluate",
  describeRoute({
    description: "Run evaluation with a specific evaluator",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(evaluationResultSchema),
          },
        },
      },
    },
  }),
  zValidator("json", evaluationInputSchema),
  async (c) => {
    const project = c.get("project");
    const evaluationService = c.get("evaluationService");
    const evaluator = c.req.param("evaluator");
    const body = c.req.valid("json");

    logger.info({ projectId: project.id, evaluator }, "Running evaluation");

    try {
      const result = await evaluationService.runEvaluation({
        projectId: project.id,
        evaluatorSlug: evaluator,
        params: body,
        asGuardrail: false,
      });

      return c.json(result);
    } catch (error) {
      logger.error(
        { error, projectId: project.id, evaluator },
        "Evaluation failed"
      );

      if (error instanceof HTTPException) {
        throw error;
      }

      const statusCode =
        error instanceof Error && "statusCode" in error
          ? (error as any).statusCode
          : 500;

      throw new HTTPException(statusCode, {
        message: error instanceof Error ? error.message : "Evaluation failed",
      });
    }
  }
);

// Batch evaluation
app.post(
  "/batch/log_results",
  describeRoute({
    description: "Log batch evaluation results",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(batchEvaluationResultSchema),
          },
        },
      },
    },
  }),
  zValidator("json", batchEvaluationInputSchema),
  async (c) => {
    const project = c.get("project");
    const batchEvaluationService = c.get("batchEvaluationService");
    const body = c.req.valid("json");

    logger.info({ projectId: project.id }, "Logging batch evaluation results");

    try {
      await batchEvaluationService.logResults({
        projectId: project.id,
        params: body,
      });

      return c.json({ message: "ok" });
    } catch (error) {
      logger.error(
        { error, projectId: project.id },
        "Batch evaluation logging failed"
      );

      if (error instanceof Error) {
        throw new HTTPException(400, { message: error.message });
      }

      throw new HTTPException(500, {
        message: "Batch evaluation logging failed",
      });
    }
  }
);

// Legacy route support for backward compatibility
app.post(
  "/:evaluator{.+?}/:subpath{.+?}/evaluate",
  describeRoute({
    description: "Run evaluation with evaluator and subpath (legacy route)",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(evaluationResultSchema),
          },
        },
      },
    },
  }),
  zValidator("json", evaluationInputSchema),
  async (c) => {
    const project = c.get("project");
    const evaluationService = c.get("evaluationService");
    const evaluator = c.req.param("evaluator");
    const subpath = c.req.param("subpath");
    const body = c.req.valid("json");

    logger.info(
      { projectId: project.id, evaluator, subpath },
      "Running evaluation with subpath"
    );

    try {
      const evaluatorSlug = `${evaluator}/${subpath}`;
      const result = await evaluationService.runEvaluation({
        projectId: project.id,
        evaluatorSlug,
        params: body,
        asGuardrail: false,
      });

      return c.json(result);
    } catch (error) {
      logger.error(
        { error, projectId: project.id, evaluator, subpath },
        "Evaluation failed"
      );

      if (error instanceof Error) {
        throw new HTTPException(400, { message: error.message });
      }

      throw new HTTPException(500, { message: "Evaluation failed" });
    }
  }
);
