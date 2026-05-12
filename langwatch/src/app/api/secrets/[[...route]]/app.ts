import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import { prisma } from "~/server/db";
import { encrypt } from "~/utils/encryption";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createLogger } from "~/utils/logger/server";
import {
  type AuthMiddlewareVariables,
  authMiddleware,
  handleError,
} from "../../middleware";
import { loggerMiddleware } from "../../middleware/logger";
import { tracerMiddleware } from "../../middleware/tracer";
import { baseResponses } from "../../shared/base-responses";
import { badRequestSchema } from "../../shared/schemas";

patchZodOpenapi();

const logger = createLogger("langwatch:api:secrets");

type Variables = AuthMiddlewareVariables;

const MAX_SECRETS_PER_PROJECT = 50;

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

export const app = new Hono<{ Variables: Variables }>()
  .basePath("/api/secrets")
  .use(tracerMiddleware({ name: "secrets" }))
  .use(loggerMiddleware())
  .use(authMiddleware)
  .onError(handleError)

  // ── List Secrets ────────────────────────────────────────────
  .get(
    "/",
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

      const secrets = await prisma.projectSecret.findMany({
        where: { projectId: project.id },
        select: {
          id: true,
          projectId: true,
          name: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { name: "asc" },
      });

      return c.json(
        secrets.map((s) => ({
          id: s.id,
          projectId: s.projectId,
          name: s.name,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
        }))
      );
    }
  )

  // ── Get Secret ──────────────────────────────────────────────
  .get(
    "/:id",
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

      const secret = await prisma.projectSecret.findFirst({
        where: { id, projectId: project.id },
        select: {
          id: true,
          projectId: true,
          name: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!secret) {
        return c.json({ error: "Secret not found" }, 404);
      }

      return c.json({
        id: secret.id,
        projectId: secret.projectId,
        name: secret.name,
        createdAt: secret.createdAt.toISOString(),
        updatedAt: secret.updatedAt.toISOString(),
      });
    }
  )

  // ── Create Secret ───────────────────────────────────────────
  .post(
    "/",
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

      const count = await prisma.projectSecret.count({
        where: { projectId: project.id },
      });

      if (count >= MAX_SECRETS_PER_PROJECT) {
        return c.json(
          {
            error: `Maximum of ${MAX_SECRETS_PER_PROJECT} secrets per project reached`,
          },
          422
        );
      }

      const existing = await prisma.projectSecret.findFirst({
        where: { projectId: project.id, name: body.name },
        select: { id: true },
      });

      if (existing) {
        return c.json(
          { error: `A secret with the name "${body.name}" already exists` },
          409
        );
      }

      const encryptedValue = encrypt(body.value);

      // API key auth has no user context — use first team member as owner
      const teamUser = await prisma.teamUser.findFirst({
        where: { teamId: project.teamId },
        select: { userId: true },
      });
      const userId = teamUser?.userId ?? "system";

      const secret = await prisma.projectSecret.create({
        data: {
          projectId: project.id,
          name: body.name,
          encryptedValue,
          createdById: userId,
          updatedById: userId,
        },
        select: {
          id: true,
          projectId: true,
          name: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return c.json(
        {
          id: secret.id,
          projectId: secret.projectId,
          name: secret.name,
          createdAt: secret.createdAt.toISOString(),
          updatedAt: secret.updatedAt.toISOString(),
        },
        201
      );
    }
  )

  // ── Update Secret ───────────────────────────────────────────
  .put(
    "/:id",
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

      const existing = await prisma.projectSecret.findFirst({
        where: { id, projectId: project.id },
        select: { id: true },
      });

      if (!existing) {
        return c.json({ error: "Secret not found" }, 404);
      }

      const encryptedValue = encrypt(body.value);

      const secret = await prisma.projectSecret.update({
        where: { id, projectId: project.id },
        data: { encryptedValue },
        select: {
          id: true,
          projectId: true,
          name: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return c.json({
        id: secret.id,
        projectId: secret.projectId,
        name: secret.name,
        createdAt: secret.createdAt.toISOString(),
        updatedAt: secret.updatedAt.toISOString(),
      });
    }
  )

  // ── Delete Secret ───────────────────────────────────────────
  .delete(
    "/:id",
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

      const existing = await prisma.projectSecret.findFirst({
        where: { id, projectId: project.id },
        select: { id: true },
      });

      if (!existing) {
        return c.json({ error: "Secret not found" }, 404);
      }

      await prisma.projectSecret.delete({
        where: { id, projectId: project.id },
      });

      return c.json({ id, deleted: true });
    }
  );
