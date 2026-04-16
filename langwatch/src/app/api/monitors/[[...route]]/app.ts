import type { Prisma } from "@prisma/client";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import { prisma } from "~/server/db";
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
import { platformUrl } from "../../shared/platform-url";
import { badRequestSchema } from "../../shared/schemas";

patchZodOpenapi();

const logger = createLogger("langwatch:api:monitors");

type Variables = AuthMiddlewareVariables;

const executionModeEnum = z.enum(["ON_MESSAGE", "AS_GUARDRAIL", "MANUALLY"]);

const monitorResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  checkType: z.string(),
  enabled: z.boolean(),
  executionMode: executionModeEnum,
  sample: z.number(),
  level: z.string(),
  evaluatorId: z.string().nullable(),
  preconditions: z.unknown(),
  parameters: z.unknown(),
  mappings: z.unknown().nullable(),
  threadIdleTimeout: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const monitorResponseWithPlatformUrlSchema = monitorResponseSchema.extend({
  platformUrl: z.string().url(),
});

const createMonitorSchema = z.object({
  name: z.string().min(1, "name is required"),
  checkType: z.string().min(1, "checkType is required"),
  executionMode: executionModeEnum.default("ON_MESSAGE"),
  preconditions: z.array(z.unknown()).default([]),
  parameters: z.record(z.unknown()).default({}),
  mappings: z.record(z.unknown()).optional(),
  sample: z.number().min(0).max(1).default(1.0),
  evaluatorId: z.string().optional(),
  level: z.enum(["trace", "thread"]).default("trace"),
  threadIdleTimeout: z.number().int().positive().nullable().optional(),
});

const updateMonitorSchema = z.object({
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  checkType: z.string().optional(),
  executionMode: executionModeEnum.optional(),
  preconditions: z.array(z.unknown()).optional(),
  parameters: z.record(z.unknown()).optional(),
  mappings: z.record(z.unknown()).optional(),
  sample: z.number().min(0).max(1).optional(),
  evaluatorId: z.string().nullable().optional(),
  level: z.enum(["trace", "thread"]).optional(),
  threadIdleTimeout: z.number().int().positive().nullable().optional(),
});

function toMonitorResponse(monitor: {
  id: string;
  name: string;
  slug: string;
  checkType: string;
  enabled: boolean;
  executionMode: string;
  sample: number;
  level: string;
  evaluatorId: string | null;
  preconditions: unknown;
  parameters: unknown;
  mappings: unknown;
  threadIdleTimeout: number | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: monitor.id,
    name: monitor.name,
    slug: monitor.slug,
    checkType: monitor.checkType,
    enabled: monitor.enabled,
    executionMode: monitor.executionMode,
    sample: monitor.sample,
    level: monitor.level,
    evaluatorId: monitor.evaluatorId,
    preconditions: monitor.preconditions,
    parameters: monitor.parameters,
    mappings: monitor.mappings,
    threadIdleTimeout: monitor.threadIdleTimeout,
    createdAt: monitor.createdAt.toISOString(),
    updatedAt: monitor.updatedAt.toISOString(),
  };
}

export const app = new Hono<{ Variables: Variables }>()
  .basePath("/api/monitors")
  .use(tracerMiddleware({ name: "monitors" }))
  .use(loggerMiddleware())
  .use(authMiddleware)
  .onError(handleError)

  // ── List Monitors ───────────────────────────────────────────
  .get(
    "/",
    describeRoute({
      description:
        "List all online evaluation monitors for the project",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.array(monitorResponseWithPlatformUrlSchema)),
            },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      logger.info({ projectId: project.id }, "Listing monitors");

      const monitors = await prisma.monitor.findMany({
        where: { projectId: project.id },
        orderBy: { createdAt: "asc" },
      });

      return c.json(monitors.map((m) => ({
        ...toMonitorResponse(m),
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/evaluations?drawer.open=onlineEvaluation&drawer.monitorId=${m.id}`,
        }),
      })));
    }
  )

  // ── Get Monitor ─────────────────────────────────────────────
  .get(
    "/:id",
    describeRoute({
      description: "Get a monitor by its ID",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(monitorResponseWithPlatformUrlSchema),
            },
          },
        },
        404: {
          description: "Monitor not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      logger.info(
        { projectId: project.id, monitorId: id },
        "Getting monitor"
      );

      const monitor = await prisma.monitor.findFirst({
        where: { id, projectId: project.id },
      });

      if (!monitor) {
        return c.json({ error: "Monitor not found" }, 404);
      }

      return c.json({
        ...toMonitorResponse(monitor),
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/evaluations?drawer.open=onlineEvaluation&drawer.monitorId=${monitor.id}`,
        }),
      });
    }
  )

  // ── Create Monitor ──────────────────────────────────────────
  .post(
    "/",
    describeRoute({
      description: "Create a new online evaluation monitor",
      responses: {
        ...baseResponses,
        201: {
          description: "Monitor created",
          content: {
            "application/json": {
              schema: resolver(monitorResponseWithPlatformUrlSchema),
            },
          },
        },
      },
    }),
    zValidator("json", createMonitorSchema),
    async (c) => {
      const project = c.get("project");
      const body = c.req.valid("json");
      logger.info({ projectId: project.id }, "Creating monitor");

      if (body.evaluatorId) {
        const evaluator = await prisma.evaluator.findFirst({
          where: {
            id: body.evaluatorId,
            projectId: project.id,
            archivedAt: null,
          },
        });
        if (!evaluator) {
          return c.json(
            { error: "Evaluator not found or does not belong to this project" },
            404
          );
        }
      }

      const { slugify } = await import("~/utils/slugify");
      const { nanoid } = await import("nanoid");
      const slug = `${slugify(body.name)}-${nanoid(5)}`;

      const monitor = await prisma.monitor.create({
        data: {
          projectId: project.id,
          name: body.name,
          slug,
          checkType: body.checkType,
          executionMode: body.executionMode,
          preconditions: body.preconditions as Prisma.InputJsonValue,
          parameters: body.parameters as Prisma.InputJsonValue,
          mappings: (body.mappings ?? {}) as Prisma.InputJsonValue,
          sample: body.sample,
          enabled: true,
          evaluatorId: body.evaluatorId ?? null,
          level: body.level,
          threadIdleTimeout: body.threadIdleTimeout ?? null,
        },
      });

      return c.json({
        ...toMonitorResponse(monitor),
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/evaluations?drawer.open=onlineEvaluation&drawer.monitorId=${monitor.id}`,
        }),
      }, 201);
    }
  )

  // ── Update Monitor ──────────────────────────────────────────
  .patch(
    "/:id",
    describeRoute({
      description:
        "Update a monitor (name, enabled state, settings, etc.)",
      responses: {
        ...baseResponses,
        200: {
          description: "Monitor updated",
          content: {
            "application/json": {
              schema: resolver(monitorResponseWithPlatformUrlSchema),
            },
          },
        },
        404: {
          description: "Monitor not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    zValidator("json", updateMonitorSchema),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      const body = c.req.valid("json");
      logger.info(
        { projectId: project.id, monitorId: id },
        "Updating monitor"
      );

      const existing = await prisma.monitor.findFirst({
        where: { id, projectId: project.id },
      });

      if (!existing) {
        return c.json({ error: "Monitor not found" }, 404);
      }

      if (body.evaluatorId) {
        const evaluator = await prisma.evaluator.findFirst({
          where: {
            id: body.evaluatorId,
            projectId: project.id,
            archivedAt: null,
          },
        });
        if (!evaluator) {
          return c.json(
            { error: "Evaluator not found or does not belong to this project" },
            404
          );
        }
      }

      const data: Record<string, unknown> = {};
      if (body.name !== undefined) data.name = body.name;
      if (body.enabled !== undefined) data.enabled = body.enabled;
      if (body.checkType !== undefined) data.checkType = body.checkType;
      if (body.executionMode !== undefined)
        data.executionMode = body.executionMode;
      if (body.preconditions !== undefined)
        data.preconditions = body.preconditions;
      if (body.parameters !== undefined) data.parameters = body.parameters;
      if (body.mappings !== undefined) data.mappings = body.mappings;
      if (body.sample !== undefined) data.sample = body.sample;
      if (body.evaluatorId !== undefined) data.evaluatorId = body.evaluatorId;
      if (body.level !== undefined) data.level = body.level;
      if (body.threadIdleTimeout !== undefined)
        data.threadIdleTimeout = body.threadIdleTimeout;

      const monitor = await prisma.monitor.update({
        where: { id, projectId: project.id },
        data,
      });

      return c.json({
        ...toMonitorResponse(monitor),
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/evaluations?drawer.open=onlineEvaluation&drawer.monitorId=${monitor.id}`,
        }),
      });
    }
  )

  // ── Toggle Monitor ──────────────────────────────────────────
  .post(
    "/:id/toggle",
    describeRoute({
      description: "Enable or disable a monitor",
      responses: {
        ...baseResponses,
        200: {
          description: "Monitor toggled",
          content: {
            "application/json": {
              schema: resolver(
                z.object({ id: z.string(), enabled: z.boolean() })
              ),
            },
          },
        },
        404: {
          description: "Monitor not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    zValidator("json", z.object({ enabled: z.boolean() })),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      const { enabled } = c.req.valid("json");
      logger.info(
        { projectId: project.id, monitorId: id, enabled },
        "Toggling monitor"
      );

      const existing = await prisma.monitor.findFirst({
        where: { id, projectId: project.id },
      });

      if (!existing) {
        return c.json({ error: "Monitor not found" }, 404);
      }

      await prisma.monitor.update({
        where: { id, projectId: project.id },
        data: { enabled },
      });

      return c.json({ id, enabled });
    }
  )

  // ── Delete Monitor ──────────────────────────────────────────
  .delete(
    "/:id",
    describeRoute({
      description: "Delete a monitor",
      responses: {
        ...baseResponses,
        200: {
          description: "Monitor deleted",
          content: {
            "application/json": {
              schema: resolver(
                z.object({ id: z.string(), deleted: z.boolean() })
              ),
            },
          },
        },
        404: {
          description: "Monitor not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      logger.info(
        { projectId: project.id, monitorId: id },
        "Deleting monitor"
      );

      const existing = await prisma.monitor.findFirst({
        where: { id, projectId: project.id },
      });

      if (!existing) {
        return c.json({ error: "Monitor not found" }, 404);
      }

      await prisma.monitor.delete({
        where: { id, projectId: project.id },
      });

      return c.json({ id, deleted: true });
    }
  );
