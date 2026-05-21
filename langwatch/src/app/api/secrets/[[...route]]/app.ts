import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import { prisma } from "~/server/db";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createLogger } from "~/utils/logger/server";
import {
  type AuthMiddlewareVariables,
  authMiddleware, requirePermission,
  handleError,
} from "../../middleware";
import { loggerMiddleware } from "../../middleware/logger";
import { tracerMiddleware } from "../../middleware/tracer";
import { baseResponses } from "../../shared/base-responses";
import { badRequestSchema } from "../../shared/schemas";
import { SecretsService } from "../secrets.service";

patchZodOpenapi();

const logger = createLogger("langwatch:api:secrets");

type Variables = AuthMiddlewareVariables;

const SECRET_NAME_REGEX = /^[A-Z][A-Z0-9_]*$/;

const secretResponseSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const createSecretSchema = z.object({
  name: z
    .string()
    .min(1, "name is required")
    .regex(
      SECRET_NAME_REGEX,
      "name must contain only uppercase letters, digits, and underscores, and must start with a letter"
    ),
  value: z
    .string()
    .min(1, "value is required")
    .max(10_000, "value is too long"),
});

const updateSecretSchema = z.object({
  value: z
    .string()
    .min(1, "value is required")
    .max(10_000, "value is too long"),
});

const secretsService = new SecretsService(prisma);

export const app = new Hono<{ Variables: Variables }>()
  .basePath("/api/secrets")
  .use(tracerMiddleware({ name: "secrets" }))
  .use(loggerMiddleware())
  .use(authMiddleware)
  .onError(handleError)

  .get(
    "/",
    requirePermission("secrets:view"),
    describeRoute({
      description:
        "List all secrets for the project (values are never returned)",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.array(secretResponseSchema)),
            },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      logger.info({ projectId: project.id }, "Listing secrets");

      const secrets = await secretsService.getAll({ projectId: project.id });
      return c.json(secrets);
    }
  )

  .get(
    "/:id",
    requirePermission("secrets:view"),
    describeRoute({
      description: "Get a secret by its ID (value is never returned)",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(secretResponseSchema),
            },
          },
        },
        404: {
          description: "Secret not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      logger.info({ projectId: project.id, secretId: id }, "Getting secret");

      const secret = await secretsService.getById({ id, projectId: project.id });
      if (!secret) {
        return c.json({ error: "Secret not found" }, 404);
      }
      return c.json(secret);
    }
  )

  .post(
    "/",
    requirePermission("secrets:manage"),
    describeRoute({
      description:
        "Create a new project secret. The value is encrypted at rest and never returned.",
      responses: {
        ...baseResponses,
        201: {
          description: "Secret created",
          content: {
            "application/json": {
              schema: resolver(secretResponseSchema),
            },
          },
        },
        409: {
          description: "Secret with this name already exists",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    zValidator("json", createSecretSchema),
    async (c) => {
      const project = c.get("project");
      const body = c.req.valid("json");
      logger.info({ projectId: project.id }, "Creating secret");

      const result = await secretsService.create({
        projectId: project.id,
        teamId: project.teamId,
        name: body.name,
        value: body.value,
      });

      if ("error" in result) {
        return c.json({ error: result.error }, result.status);
      }

      return c.json(result.secret, 201);
    }
  )

  .put(
    "/:id",
    requirePermission("secrets:manage"),
    describeRoute({
      description: "Update a secret's value",
      responses: {
        ...baseResponses,
        200: {
          description: "Secret updated",
          content: {
            "application/json": {
              schema: resolver(secretResponseSchema),
            },
          },
        },
        404: {
          description: "Secret not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    zValidator("json", updateSecretSchema),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      const body = c.req.valid("json");
      logger.info({ projectId: project.id, secretId: id }, "Updating secret");

      const secret = await secretsService.update({
        id,
        projectId: project.id,
        value: body.value,
      });

      if (!secret) {
        return c.json({ error: "Secret not found" }, 404);
      }
      return c.json(secret);
    }
  )

  .delete(
    "/:id",
    requirePermission("secrets:manage"),
    describeRoute({
      description: "Delete a secret",
      responses: {
        ...baseResponses,
        200: {
          description: "Secret deleted",
          content: {
            "application/json": {
              schema: resolver(
                z.object({ id: z.string(), deleted: z.boolean() })
              ),
            },
          },
        },
        404: {
          description: "Secret not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      logger.info({ projectId: project.id, secretId: id }, "Deleting secret");

      const deleted = await secretsService.delete({ id, projectId: project.id });
      if (!deleted) {
        return c.json({ error: "Secret not found" }, 404);
      }
      return c.json({ id, deleted: true });
    }
  );
