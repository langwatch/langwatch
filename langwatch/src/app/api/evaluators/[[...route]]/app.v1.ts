import type { Prisma } from "@prisma/client";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { nanoid } from "nanoid";
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
import {
  apiResponseEvaluatorSchema,
  createEvaluatorInputSchema,
  updateEvaluatorInputSchema,
} from "./schemas";

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

// Create evaluator
app.post(
  "/",
  describeRoute({
    description: "Create a new evaluator",
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
    },
  }),
  zValidator("json", createEvaluatorInputSchema),
  async (c) => {
    const service = c.get("evaluatorService");
    const project = c.get("project");
    const data = c.req.valid("json");

    logger.info(
      { projectId: project.id, name: data.name },
      "Creating evaluator",
    );

    const evaluator = await service.create({
      id: `evaluator_${nanoid()}`,
      projectId: project.id,
      name: data.name,
      type: "evaluator",
      config: data.config as Prisma.InputJsonValue,
    });

    const enriched = await service.enrichWithFields(evaluator);

    logger.info(
      { projectId: project.id, evaluatorId: enriched.id },
      "Successfully created evaluator",
    );

    return c.json(apiResponseEvaluatorSchema.parse(enriched));
  },
);

// Update evaluator
app.put(
  "/:id",
  describeRoute({
    description: "Update an existing evaluator",
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
      400: {
        description: "Bad request (e.g. attempting to change evaluatorType)",
        content: {
          "application/json": { schema: resolver(badRequestSchema) },
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
  zValidator("json", updateEvaluatorInputSchema),
  async (c) => {
    const service = c.get("evaluatorService");
    const project = c.get("project");
    const { id } = c.req.param();
    const data = c.req.valid("json");

    logger.info(
      { projectId: project.id, evaluatorId: id },
      "Updating evaluator",
    );

    // Verify evaluator exists
    const existing = await service.getById({
      id,
      projectId: project.id,
    });

    if (!existing) {
      throw new HTTPException(404, {
        message: "Evaluator not found",
      });
    }

    // Enforce evaluatorType immutability
    if (data.config?.evaluatorType !== undefined) {
      const existingConfig = existing.config as { evaluatorType?: string } | null;
      const existingType = existingConfig?.evaluatorType;
      if (
        existingType !== undefined &&
        data.config.evaluatorType !== existingType
      ) {
        throw new HTTPException(400, {
          message: `evaluatorType cannot be changed after creation. Current type: "${existingType}"`,
        });
      }
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) {
      updateData.name = data.name;
    }
    if (data.config !== undefined) {
      // Merge config: keep existing config values, override with provided ones
      const existingConfig = (existing.config as Record<string, unknown>) ?? {};
      updateData.config = { ...existingConfig, ...data.config } as Prisma.InputJsonValue;
    }

    const updated = await service.update({
      id,
      projectId: project.id,
      data: updateData,
    });

    const enriched = await service.enrichWithFields(updated);

    logger.info(
      { projectId: project.id, evaluatorId: enriched.id },
      "Successfully updated evaluator",
    );

    return c.json(apiResponseEvaluatorSchema.parse(enriched));
  },
);

// Delete (archive) evaluator
app.delete(
  "/:id",
  describeRoute({
    description: "Archive (soft-delete) an evaluator",
    responses: {
      ...baseResponses,
      200: {
        description: "Success",
        content: {
          "application/json": {
            schema: resolver(
              z.object({ success: z.boolean() }),
            ),
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
    const { id } = c.req.param();

    logger.info(
      { projectId: project.id, evaluatorId: id },
      "Archiving evaluator",
    );

    // Verify evaluator exists
    const existing = await service.getById({
      id,
      projectId: project.id,
    });

    if (!existing) {
      throw new HTTPException(404, {
        message: "Evaluator not found",
      });
    }

    await service.softDelete({
      id,
      projectId: project.id,
    });

    logger.info(
      { projectId: project.id, evaluatorId: id },
      "Successfully archived evaluator",
    );

    return c.json({ success: true });
  },
);
