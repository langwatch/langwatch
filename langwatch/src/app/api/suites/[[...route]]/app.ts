import type { SimulationSuite } from "@prisma/client";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import { badRequestSchema } from "~/app/api/shared/schemas";
import { prisma } from "~/server/db";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createLogger } from "~/utils/logger/server";
import {
  type AuthMiddlewareVariables,
  authMiddleware,
} from "../../middleware";
import { loggerMiddleware } from "../../middleware/logger";
import { tracerMiddleware } from "../../middleware/tracer";
import { baseResponses } from "../../shared/base-responses";
import { handleError } from "../../middleware";
import { SuiteService } from "~/server/suites/suite.service";
import { SuiteDomainError } from "~/server/suites/errors";
import { ProjectRepository } from "~/server/projects/project.repository";
import { getApp } from "~/server/app-layer/app";

patchZodOpenapi();

const logger = createLogger("langwatch:api:suites");

type Variables = AuthMiddlewareVariables;

const suiteTargetSchema = z.object({
  type: z.enum(["prompt", "http", "code", "workflow"]),
  referenceId: z.string(),
});

const suiteResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  scenarioIds: z.array(z.string()),
  targets: z.array(suiteTargetSchema),
  repeatCount: z.number(),
  labels: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const createSuiteInputSchema = z.object({
  name: z.string().min(1, "name is required"),
  description: z.string().optional(),
  scenarioIds: z.array(z.string()).min(1, "At least one scenario is required"),
  targets: z.array(suiteTargetSchema).min(1, "At least one target is required"),
  repeatCount: z.number().int().min(1).max(100).default(1),
  labels: z.array(z.string()).default([]),
});

const updateSuiteInputSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  scenarioIds: z.array(z.string()).min(1).optional(),
  targets: z.array(suiteTargetSchema).min(1).optional(),
  repeatCount: z.number().int().min(1).max(100).optional(),
  labels: z.array(z.string()).optional(),
});

const runSuiteInputSchema = z.object({
  idempotencyKey: z.string().optional(),
});

const suiteRunResultSchema = z.object({
  scheduled: z.boolean(),
  batchRunId: z.string(),
  setId: z.string(),
  jobCount: z.number(),
  skippedArchived: z.object({
    scenarios: z.array(z.string()),
    targets: z.array(z.string()),
  }),
  items: z.array(z.object({
    scenarioRunId: z.string(),
    scenarioId: z.string(),
    target: suiteTargetSchema,
    name: z.string().nullable(),
  })),
});

function toSuiteResponse(suite: SimulationSuite) {
  const targets = Array.isArray(suite.targets)
    ? suite.targets
    : typeof suite.targets === "string"
      ? JSON.parse(suite.targets)
      : [];

  return {
    id: suite.id,
    name: suite.name,
    slug: suite.slug,
    description: suite.description,
    scenarioIds: suite.scenarioIds,
    targets,
    repeatCount: suite.repeatCount,
    labels: suite.labels,
    createdAt: suite.createdAt.toISOString(),
    updatedAt: suite.updatedAt.toISOString(),
  };
}

function createService() {
  return SuiteService.create({
    prisma,
    suiteRunService: getApp().suiteRuns.runs,
  });
}

export const app = new Hono<{ Variables: Variables }>()
  .basePath("/api/suites")
  .use(tracerMiddleware({ name: "suites" }))
  .use(loggerMiddleware())
  .use(authMiddleware)
  .onError(handleError)

  // ── List Suites ────────────────────────────────────────────
  .get(
    "/",
    describeRoute({
      description: "List all non-archived suites (run plans) for the project",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.array(suiteResponseSchema)),
            },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      logger.info({ projectId: project.id }, "Listing suites");

      const service = createService();
      const suites = await service.getAll({ projectId: project.id });

      return c.json(suites.map(toSuiteResponse));
    },
  )

  // ── Get Suite ──────────────────────────────────────────────
  .get(
    "/:id",
    describeRoute({
      description: "Get a suite (run plan) by its ID",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(suiteResponseSchema),
            },
          },
        },
        404: {
          description: "Suite not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      logger.info({ projectId: project.id, suiteId: id }, "Getting suite");

      const service = createService();
      const suite = await service.getById({ id, projectId: project.id });

      if (!suite) {
        return c.json({ error: "Suite not found" }, 404);
      }

      return c.json(toSuiteResponse(suite));
    },
  )

  // ── Create Suite ───────────────────────────────────────────
  .post(
    "/",
    describeRoute({
      description: "Create a new suite (run plan)",
      responses: {
        ...baseResponses,
        201: {
          description: "Suite created",
          content: {
            "application/json": {
              schema: resolver(suiteResponseSchema),
            },
          },
        },
      },
    }),
    zValidator("json", createSuiteInputSchema),
    async (c) => {
      const project = c.get("project");
      const body = c.req.valid("json");
      logger.info({ projectId: project.id }, "Creating suite");

      const service = createService();
      try {
        const suite = await service.create({
          ...body,
          projectId: project.id,
        });
        return c.json(toSuiteResponse(suite), 201);
      } catch (error) {
        if (error instanceof SuiteDomainError) {
          return c.json({ error: error.message }, 400);
        }
        throw error;
      }
    },
  )

  // ── Update Suite ───────────────────────────────────────────
  .patch(
    "/:id",
    describeRoute({
      description: "Update a suite (run plan)",
      responses: {
        ...baseResponses,
        200: {
          description: "Suite updated",
          content: {
            "application/json": {
              schema: resolver(suiteResponseSchema),
            },
          },
        },
        404: {
          description: "Suite not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    zValidator("json", updateSuiteInputSchema),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      const body = c.req.valid("json");
      logger.info({ projectId: project.id, suiteId: id }, "Updating suite");

      const service = createService();
      try {
        const suite = await service.update({
          id,
          projectId: project.id,
          data: body,
        });
        return c.json(toSuiteResponse(suite));
      } catch (error) {
        if (error instanceof SuiteDomainError) {
          return c.json({ error: error.message }, 400);
        }
        throw error;
      }
    },
  )

  // ── Duplicate Suite ────────────────────────────────────────
  .post(
    "/:id/duplicate",
    describeRoute({
      description: "Duplicate a suite (run plan)",
      responses: {
        ...baseResponses,
        201: {
          description: "Suite duplicated",
          content: {
            "application/json": {
              schema: resolver(suiteResponseSchema),
            },
          },
        },
        404: {
          description: "Suite not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      logger.info({ projectId: project.id, suiteId: id }, "Duplicating suite");

      const service = createService();
      try {
        const suite = await service.duplicate({ id, projectId: project.id });
        return c.json(toSuiteResponse(suite), 201);
      } catch (error) {
        if (error instanceof SuiteDomainError) {
          return c.json({ error: error.message }, 404);
        }
        throw error;
      }
    },
  )

  // ── Run Suite ──────────────────────────────────────────────
  .post(
    "/:id/run",
    describeRoute({
      description: "Trigger a suite run. Schedules scenario executions for all active scenarios × targets × repeatCount.",
      responses: {
        ...baseResponses,
        200: {
          description: "Suite run scheduled",
          content: {
            "application/json": {
              schema: resolver(suiteRunResultSchema),
            },
          },
        },
        404: {
          description: "Suite not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    zValidator("json", runSuiteInputSchema),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      const body = c.req.valid("json");
      logger.info({ projectId: project.id, suiteId: id }, "Running suite");

      const service = createService();
      const suite = await service.getById({ id, projectId: project.id });

      if (!suite) {
        return c.json({ error: "Suite not found" }, 404);
      }

      const projectRepository = new ProjectRepository(prisma);
      const organizationId = await projectRepository.getOrganizationId({
        projectId: project.id,
      });
      if (!organizationId) {
        return c.json({ error: "Organization not found for project" }, 404);
      }

      try {
        const idempotencyKey = body.idempotencyKey ?? `api-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const result = await service.run({
          suite,
          projectId: project.id,
          organizationId,
          idempotencyKey,
        });

        return c.json({
          scheduled: true,
          ...result,
        });
      } catch (error) {
        if (error instanceof SuiteDomainError) {
          return c.json({ error: error.message }, 400);
        }
        throw error;
      }
    },
  )

  // ── Delete (Archive) Suite ─────────────────────────────────
  .delete(
    "/:id",
    describeRoute({
      description: "Archive (soft-delete) a suite (run plan)",
      responses: {
        ...baseResponses,
        200: {
          description: "Suite archived",
          content: {
            "application/json": {
              schema: resolver(z.object({ id: z.string(), archived: z.boolean() })),
            },
          },
        },
        404: {
          description: "Suite not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      logger.info({ projectId: project.id, suiteId: id }, "Archiving suite");

      const service = createService();
      const result = await service.archive({ id, projectId: project.id });

      if (!result) {
        return c.json({ error: "Suite not found" }, 404);
      }

      return c.json({ id, archived: true });
    },
  );
