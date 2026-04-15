import type { Prisma, Trigger } from "@prisma/client";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { nanoid } from "nanoid";
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
import { platformUrl } from "../../shared/platform-url";
import { handleError } from "../../middleware";

patchZodOpenapi();

const logger = createLogger("langwatch:api:triggers");

type Variables = AuthMiddlewareVariables;

const triggerActionEnum = z.enum([
  "SEND_EMAIL",
  "ADD_TO_DATASET",
  "ADD_TO_ANNOTATION_QUEUE",
  "SEND_SLACK_MESSAGE",
]);

const alertTypeEnum = z.enum(["CRITICAL", "WARNING", "INFO"]);

const triggerResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  action: triggerActionEnum,
  actionParams: z.record(z.unknown()),
  filters: z.record(z.unknown()),
  active: z.boolean(),
  message: z.string().nullable(),
  alertType: alertTypeEnum.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const createTriggerSchema = z.object({
  name: z.string().min(1, "name is required"),
  action: triggerActionEnum,
  actionParams: z.record(z.unknown()).default({}),
  filters: z.record(z.unknown()).default({}),
  message: z.string().optional(),
  alertType: alertTypeEnum.optional(),
});

const updateTriggerSchema = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
  message: z.string().nullable().optional(),
  alertType: alertTypeEnum.nullable().optional(),
  filters: z.record(z.unknown()).optional(),
  actionParams: z.record(z.unknown()).optional(),
});

function toTriggerResponse(trigger: Trigger) {
  let filters: Record<string, unknown> = {};
  if (typeof trigger.filters === "string") {
    try {
      filters = JSON.parse(trigger.filters) as Record<string, unknown>;
    } catch {
      filters = {};
    }
  } else if (trigger.filters && typeof trigger.filters === "object") {
    filters = trigger.filters as Record<string, unknown>;
  }

  return {
    id: trigger.id,
    name: trigger.name,
    action: trigger.action,
    actionParams: (trigger.actionParams ?? {}) as Record<string, unknown>,
    filters,
    active: trigger.active,
    message: trigger.message,
    alertType: trigger.alertType,
    createdAt: trigger.createdAt.toISOString(),
    updatedAt: trigger.updatedAt.toISOString(),
  };
}

export const app = new Hono<{ Variables: Variables }>()
  .basePath("/api/triggers")
  .use(tracerMiddleware({ name: "triggers" }))
  .use(loggerMiddleware())
  .use(authMiddleware)
  .onError(handleError)

  // ── List Triggers ──────────────────────────────────────────
  .get(
    "/",
    describeRoute({
      description: "List all active triggers (automations) for the project",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.array(triggerResponseSchema)),
            },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      logger.info({ projectId: project.id }, "Listing triggers");

      const triggers = await prisma.trigger.findMany({
        where: { projectId: project.id, deleted: false },
        orderBy: { createdAt: "desc" },
      });

      return c.json(triggers.map((t) => ({
        ...toTriggerResponse(t),
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/automations?drawer.open=editAutomationFilter&drawer.automationId=${t.id}`,
        }),
      })));
    },
  )

  // ── Get Trigger ────────────────────────────────────────────
  .get(
    "/:id",
    describeRoute({
      description: "Get a trigger by its ID",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(triggerResponseSchema),
            },
          },
        },
        404: {
          description: "Trigger not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      logger.info({ projectId: project.id, triggerId: id }, "Getting trigger");

      const trigger = await prisma.trigger.findFirst({
        where: { id, projectId: project.id, deleted: false },
      });

      if (!trigger) {
        return c.json({ error: "Trigger not found" }, 404);
      }

      return c.json({
        ...toTriggerResponse(trigger),
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/automations?drawer.open=editAutomationFilter&drawer.automationId=${trigger.id}`,
        }),
      });
    },
  )

  // ── Create Trigger ─────────────────────────────────────────
  .post(
    "/",
    describeRoute({
      description: "Create a new trigger (automation)",
      responses: {
        ...baseResponses,
        201: {
          description: "Trigger created",
          content: {
            "application/json": {
              schema: resolver(triggerResponseSchema),
            },
          },
        },
      },
    }),
    zValidator("json", createTriggerSchema),
    async (c) => {
      const project = c.get("project");
      const body = c.req.valid("json");
      logger.info({ projectId: project.id }, "Creating trigger");

      const trigger = await prisma.trigger.create({
        data: {
          id: nanoid(),
          name: body.name,
          action: body.action,
          actionParams: body.actionParams as Prisma.InputJsonValue,
          filters: JSON.stringify(body.filters),
          projectId: project.id,
          lastRunAt: new Date().getTime(),
          message: body.message ?? null,
          alertType: body.alertType ?? null,
        },
      });

      return c.json({
        ...toTriggerResponse(trigger),
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/automations?drawer.open=editAutomationFilter&drawer.automationId=${trigger.id}`,
        }),
      }, 201);
    },
  )

  // ── Update Trigger ─────────────────────────────────────────
  .patch(
    "/:id",
    describeRoute({
      description: "Update a trigger (name, active state, message, filters)",
      responses: {
        ...baseResponses,
        200: {
          description: "Trigger updated",
          content: {
            "application/json": {
              schema: resolver(triggerResponseSchema),
            },
          },
        },
        404: {
          description: "Trigger not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    zValidator("json", updateTriggerSchema),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      const body = c.req.valid("json");
      logger.info({ projectId: project.id, triggerId: id }, "Updating trigger");

      const trigger = await prisma.trigger.findFirst({
        where: { id, projectId: project.id, deleted: false },
      });

      if (!trigger) {
        return c.json({ error: "Trigger not found" }, 404);
      }

      const data: Record<string, unknown> = {};
      if (body.name !== undefined) data.name = body.name;
      if (body.active !== undefined) data.active = body.active;
      if (body.message !== undefined) data.message = body.message;
      if (body.alertType !== undefined) data.alertType = body.alertType;
      if (body.filters !== undefined) data.filters = JSON.stringify(body.filters);
      if (body.actionParams !== undefined) data.actionParams = body.actionParams;

      const updated = await prisma.trigger.update({
        where: { id, projectId: project.id },
        data,
      });

      return c.json({
        ...toTriggerResponse(updated),
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/automations?drawer.open=editAutomationFilter&drawer.automationId=${updated.id}`,
        }),
      });
    },
  )

  // ── Delete Trigger ─────────────────────────────────────────
  .delete(
    "/:id",
    describeRoute({
      description: "Delete (soft-delete) a trigger",
      responses: {
        ...baseResponses,
        200: {
          description: "Trigger deleted",
          content: {
            "application/json": {
              schema: resolver(z.object({ id: z.string(), deleted: z.boolean() })),
            },
          },
        },
        404: {
          description: "Trigger not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      logger.info({ projectId: project.id, triggerId: id }, "Deleting trigger");

      const trigger = await prisma.trigger.findFirst({
        where: { id, projectId: project.id, deleted: false },
      });

      if (!trigger) {
        return c.json({ error: "Trigger not found" }, 404);
      }

      await prisma.trigger.update({
        where: { id, projectId: project.id },
        data: { deleted: true, active: false },
      });

      return c.json({ id, deleted: true });
    },
  );
