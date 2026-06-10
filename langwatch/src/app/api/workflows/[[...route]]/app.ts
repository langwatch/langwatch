import type { Workflow } from "@prisma/client";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import { badRequestSchema } from "~/app/api/shared/schemas";
import { prisma } from "~/server/db";
import { patchZodOpenapi } from "~/utils/extend-zod-openapi";
import { createLogger } from "~/utils/logger/server";
import { createProjectApp, requires } from "~/server/api/security";
import {
  NoCommittedVersionError,
  WorkflowEvaluationService,
  WorkflowNotFoundError,
} from "~/server/workflows/workflowEvaluation.service";
import { baseResponses } from "../../shared/base-responses";
import { platformUrl } from "../../shared/platform-url";

patchZodOpenapi();

const logger = createLogger("langwatch:api:workflows");

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

const workflowResponseWithPlatformUrlSchema = workflowResponseSchema.extend({
  platformUrl: z.string().url(),
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

const secured = createProjectApp({ basePath: "/api/workflows" });

secured.access(requires("workflows:view")).get(
    "/",
    describeRoute({
      description: "List all non-archived workflows for the project",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.array(workflowResponseWithPlatformUrlSchema)),
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
  );

secured.access(requires("workflows:view")).get(
    "/:id",
    describeRoute({
      description: "Get a workflow by its ID",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(workflowResponseWithPlatformUrlSchema),
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
  );

secured.access(requires("workflows:manage")).patch(
    "/:id",
    describeRoute({
      description: "Update a workflow's metadata (name, icon, description)",
      responses: {
        ...baseResponses,
        200: {
          description: "Workflow updated",
          content: {
            "application/json": {
              schema: resolver(workflowResponseWithPlatformUrlSchema),
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
  );

secured.access(requires("workflows:manage")).delete(
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

const evaluateBodySchema = z.object({
  version_id: z
    .string()
    .optional()
    .describe("Committed version to evaluate; defaults to the latest commit"),
  evaluate_on: z
    .enum(["full", "test", "train"])
    .optional()
    .describe("Which dataset slice to evaluate; defaults to full"),
  parameters: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe(
      "Constant entry inputs applied to every row, e.g. a feature flag or PR number",
    ),
});

secured.access(requires("workflows:manage")).post(
    "/:id/evaluate",
    describeRoute({
      description:
        "Trigger an evaluation run of a workflow's committed version. " +
        "Parameters bind as constant entry inputs on every dataset row; " +
        "results land on the workflow's experiment like studio-triggered runs.",
      responses: {
        ...baseResponses,
        200: {
          description: "Evaluation started",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  run_id: z.string(),
                  workflow_version_id: z.string(),
                  version: z.string(),
                }),
              ),
            },
          },
        },
        400: {
          description: "No committed version to evaluate",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
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
    zValidator("json", evaluateBodySchema),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      const body = c.req.valid("json");
      logger.info(
        { projectId: project.id, workflowId: id },
        "Triggering workflow evaluation via API",
      );

      try {
        const result = await WorkflowEvaluationService.create(
          prisma,
        ).triggerEvaluation({
          projectId: project.id,
          workflowId: id,
          versionId: body.version_id,
          evaluateOn: body.evaluate_on,
          parameters: body.parameters,
        });
        return c.json({
          run_id: result.runId,
          workflow_version_id: result.workflowVersionId,
          version: result.version,
        });
      } catch (error) {
        if (error instanceof WorkflowNotFoundError) {
          return c.json({ error: "Workflow not found" }, 404);
        }
        if (error instanceof NoCommittedVersionError) {
          return c.json({ error: error.message }, 400);
        }
        throw error;
      }
    },
  );

export const app = secured.hono;
