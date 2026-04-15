import type { Workflow } from "@prisma/client";
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
import { platformUrl } from "../../shared/platform-url";
import { handleError } from "../../middleware";

patchZodOpenapi();

const logger = createLogger("langwatch:api:workflows");

type Variables = AuthMiddlewareVariables;

const workflowResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string().nullable(),
  description: z.string().nullable(),
  isEvaluator: z.boolean(),
  isComponent: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

function toWorkflowResponse(workflow: Workflow) {
  return {
    id: workflow.id,
    name: workflow.name,
    icon: workflow.icon,
    description: workflow.description,
    isEvaluator: workflow.isEvaluator,
    isComponent: workflow.isComponent,
    createdAt: workflow.createdAt.toISOString(),
    updatedAt: workflow.updatedAt.toISOString(),
  };
}

export const app = new Hono<{ Variables: Variables }>()
  .basePath("/api/workflows")
  .use(tracerMiddleware({ name: "workflows" }))
  .use(loggerMiddleware())
  .use(authMiddleware)
  .onError(handleError)

  .get(
    "/",
    describeRoute({
      description: "List all non-archived workflows for the project",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.array(workflowResponseSchema)),
            },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      logger.info({ projectId: project.id }, "Listing workflows");

      const workflows = await prisma.workflow.findMany({
        where: { projectId: project.id, archivedAt: null },
        orderBy: { updatedAt: "desc" },
      });

      return c.json(workflows.map((w) => ({
        ...toWorkflowResponse(w),
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/workflows`,
        }),
      })));
    },
  )

  .get(
    "/:id",
    describeRoute({
      description: "Get a workflow by its ID",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(workflowResponseSchema),
            },
          },
        },
        404: {
          description: "Workflow not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      logger.info({ projectId: project.id, workflowId: id }, "Getting workflow");

      const workflow = await prisma.workflow.findFirst({
        where: { id, projectId: project.id, archivedAt: null },
      });

      if (!workflow) {
        return c.json({ error: "Workflow not found" }, 404);
      }

      return c.json({
        ...toWorkflowResponse(workflow),
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/workflows`,
        }),
      });
    },
  )

  .patch(
    "/:id",
    describeRoute({
      description: "Update a workflow's metadata (name, icon, description)",
      responses: {
        ...baseResponses,
        200: {
          description: "Workflow updated",
          content: {
            "application/json": {
              schema: resolver(workflowResponseSchema),
            },
          },
        },
        404: {
          description: "Workflow not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    zValidator("json", z.object({
      name: z.string().min(1).optional(),
      icon: z.string().optional(),
      description: z.string().optional(),
    })),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      const body = c.req.valid("json");
      logger.info({ projectId: project.id, workflowId: id }, "Updating workflow");

      const workflow = await prisma.workflow.findFirst({
        where: { id, projectId: project.id, archivedAt: null },
      });

      if (!workflow) {
        return c.json({ error: "Workflow not found" }, 404);
      }

      const updated = await prisma.workflow.update({
        where: { id, projectId: project.id },
        data: body,
      });

      return c.json({
        ...toWorkflowResponse(updated),
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/workflows`,
        }),
      });
    },
  )

  .delete(
    "/:id",
    describeRoute({
      description: "Archive (soft-delete) a workflow",
      responses: {
        ...baseResponses,
        200: {
          description: "Workflow archived",
          content: {
            "application/json": {
              schema: resolver(z.object({ id: z.string(), archived: z.boolean() })),
            },
          },
        },
        404: {
          description: "Workflow not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      logger.info({ projectId: project.id, workflowId: id }, "Archiving workflow");

      const workflow = await prisma.workflow.findFirst({
        where: { id, projectId: project.id, archivedAt: null },
      });

      if (!workflow) {
        return c.json({ error: "Workflow not found" }, 404);
      }

      await prisma.workflow.update({
        where: { id, projectId: project.id },
        data: { archivedAt: new Date() },
      });

      return c.json({ id, archived: true });
    },
  );
