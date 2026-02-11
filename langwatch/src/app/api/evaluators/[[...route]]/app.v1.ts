import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/zod";
import { z } from "zod";
import { badRequestSchema } from "~/app/api/shared/schemas";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createLogger } from "~/utils/logger/server";
import {
  type AuthMiddlewareVariables,
  type OrganizationMiddlewareVariables,
  organizationMiddleware,
} from "../../middleware";
import {
  type EvaluatorServiceMiddlewareVariables,
  evaluatorServiceMiddleware,
} from "../../middleware/evaluator-service";
import { baseResponses } from "../../shared/base-responses";
import { apiResponseEvaluatorSchema } from "./schemas";

const logger = createLogger("langwatch:api:evaluators");

patchZodOpenapi();

type Variables = EvaluatorServiceMiddlewareVariables &
  AuthMiddlewareVariables &
  OrganizationMiddlewareVariables;

export const app = new Hono<{
  Variables: Variables;
}>().basePath("/");

// Middleware
app.use("/*", organizationMiddleware);
app.use("/*", evaluatorServiceMiddleware);

// Get all evaluators
app.get(
  "/",
  describeRoute({
    description: "Get all evaluators for a project",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(z.array(apiResponseEvaluatorSchema)),
          },
        },
      },
    },
  }),
  async (c) => {
    const service = c.get("evaluatorService");
    const project = c.get("project");

    logger.info({ projectId: project.id }, "Getting all evaluators for project");

    const evaluators = await service.getAllWithFields({
      projectId: project.id,
    });

    return c.json(apiResponseEvaluatorSchema.array().parse(evaluators));
  },
);

// Get evaluator by ID or slug
app.get(
  "/:idOrSlug{.+}",
  describeRoute({
    description: "Get a specific evaluator by ID or slug",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(apiResponseEvaluatorSchema),
          },
        },
      },
      404: {
        description: "Evaluator not found",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
        },
      },
    },
  }),
  async (c) => {
    const service = c.get("evaluatorService");
    const project = c.get("project");
    const { idOrSlug } = c.req.param();

    logger.info({ projectId: project.id, idOrSlug }, "Getting evaluator");

    // Try by ID first, then by slug
    let evaluator = await service.getByIdWithFields({
      id: idOrSlug,
      projectId: project.id,
    });

    if (!evaluator) {
      const bySlug = await service.getBySlug({
        slug: idOrSlug,
        projectId: project.id,
      });
      if (bySlug) {
        evaluator = await service.enrichWithFields(bySlug);
      }
    }

    if (!evaluator) {
      throw new HTTPException(404, {
        message: "Evaluator not found",
      });
    }

    return c.json(apiResponseEvaluatorSchema.parse(evaluator));
  },
);
