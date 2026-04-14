import type { CustomGraph, Prisma } from "@prisma/client";
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
import { handleError } from "../../middleware";

patchZodOpenapi();

const logger = createLogger("langwatch:api:graphs");

type Variables = AuthMiddlewareVariables;

const graphResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  graph: z.record(z.unknown()),
  filters: z.record(z.unknown()).nullable(),
  dashboardId: z.string().nullable(),
  gridColumn: z.number(),
  gridRow: z.number(),
  colSpan: z.number(),
  rowSpan: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const createGraphSchema = z.object({
  name: z.string().min(1, "name is required"),
  graph: z.record(z.unknown()),
  dashboardId: z.string().optional(),
  filters: z.record(z.unknown()).optional(),
  gridColumn: z.number().min(0).max(1).optional(),
  gridRow: z.number().min(0).optional(),
  colSpan: z.number().min(1).max(2).optional(),
  rowSpan: z.number().min(1).max(2).optional(),
});

const updateGraphSchema = z.object({
  name: z.string().min(1).optional(),
  graph: z.record(z.unknown()).optional(),
  filters: z.record(z.unknown()).optional(),
});

function toGraphResponse(graph: CustomGraph) {
  return {
    id: graph.id,
    name: graph.name,
    graph: (graph.graph ?? {}) as Record<string, unknown>,
    filters: (graph.filters ?? null) as Record<string, unknown> | null,
    dashboardId: graph.dashboardId,
    gridColumn: graph.gridColumn,
    gridRow: graph.gridRow,
    colSpan: graph.colSpan,
    rowSpan: graph.rowSpan,
    createdAt: graph.createdAt.toISOString(),
    updatedAt: graph.updatedAt.toISOString(),
  };
}

export const app = new Hono<{ Variables: Variables }>()
  .basePath("/api/graphs")
  .use(tracerMiddleware({ name: "graphs" }))
  .use(loggerMiddleware())
  .use(authMiddleware)
  .onError(handleError)

  // ── List Graphs ────────────────────────────────────────────
  .get(
    "/",
    describeRoute({
      description: "List all custom graphs, optionally filtered by dashboard",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.array(graphResponseSchema)),
            },
          },
        },
      },
    }),
    zValidator("query", z.object({
      dashboardId: z.string().optional(),
    })),
    async (c) => {
      const project = c.get("project");
      const { dashboardId } = c.req.valid("query");
      logger.info({ projectId: project.id, dashboardId }, "Listing graphs");

      const graphs = await prisma.customGraph.findMany({
        where: {
          projectId: project.id,
          ...(dashboardId ? { dashboardId } : {}),
        },
        orderBy: dashboardId
          ? [{ gridRow: "asc" }, { gridColumn: "asc" }]
          : { createdAt: "desc" },
      });

      return c.json(graphs.map(toGraphResponse));
    },
  )

  // ── Get Graph ──────────────────────────────────────────────
  .get(
    "/:id",
    describeRoute({
      description: "Get a custom graph by its ID",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(graphResponseSchema),
            },
          },
        },
        404: {
          description: "Graph not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();

      const graph = await prisma.customGraph.findFirst({
        where: { id, projectId: project.id },
      });

      if (!graph) {
        return c.json({ error: "Graph not found" }, 404);
      }

      return c.json(toGraphResponse(graph));
    },
  )

  // ── Create Graph ───────────────────────────────────────────
  .post(
    "/",
    describeRoute({
      description: "Create a custom graph on a dashboard",
      responses: {
        ...baseResponses,
        201: {
          description: "Graph created",
          content: {
            "application/json": {
              schema: resolver(graphResponseSchema),
            },
          },
        },
      },
    }),
    zValidator("json", createGraphSchema),
    async (c) => {
      const project = c.get("project");
      const body = c.req.valid("json");
      logger.info({ projectId: project.id }, "Creating graph");

      let gridRow = body.gridRow;
      if (gridRow === undefined && body.dashboardId) {
        const lastGraph = await prisma.customGraph.findFirst({
          where: { dashboardId: body.dashboardId, projectId: project.id },
          orderBy: { gridRow: "desc" },
        });
        gridRow = (lastGraph?.gridRow ?? -1) + 1;
      }

      const graph = await prisma.customGraph.create({
        data: {
          id: nanoid(),
          name: body.name,
          graph: body.graph as Prisma.InputJsonValue,
          projectId: project.id,
          filters: (body.filters ?? {}) as Prisma.InputJsonValue,
          dashboardId: body.dashboardId ?? null,
          gridColumn: body.gridColumn ?? 0,
          gridRow: gridRow ?? 0,
          colSpan: body.colSpan ?? 1,
          rowSpan: body.rowSpan ?? 1,
        },
      });

      return c.json(toGraphResponse(graph), 201);
    },
  )

  // ── Update Graph ───────────────────────────────────────────
  .patch(
    "/:id",
    describeRoute({
      description: "Update a custom graph's name, definition, or filters",
      responses: {
        ...baseResponses,
        200: {
          description: "Graph updated",
          content: {
            "application/json": {
              schema: resolver(graphResponseSchema),
            },
          },
        },
        404: {
          description: "Graph not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    zValidator("json", updateGraphSchema),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();
      const body = c.req.valid("json");

      const graph = await prisma.customGraph.findFirst({
        where: { id, projectId: project.id },
      });

      if (!graph) {
        return c.json({ error: "Graph not found" }, 404);
      }

      const updated = await prisma.customGraph.update({
        where: { id, projectId: project.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.graph !== undefined ? { graph: body.graph as Prisma.InputJsonValue } : {}),
          ...(body.filters !== undefined ? { filters: body.filters as Prisma.InputJsonValue } : {}),
        },
      });

      return c.json(toGraphResponse(updated));
    },
  )

  // ── Delete Graph ───────────────────────────────────────────
  .delete(
    "/:id",
    describeRoute({
      description: "Delete a custom graph",
      responses: {
        ...baseResponses,
        200: {
          description: "Graph deleted",
          content: {
            "application/json": {
              schema: resolver(z.object({ id: z.string(), deleted: z.boolean() })),
            },
          },
        },
        404: {
          description: "Graph not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { id } = c.req.param();

      const graph = await prisma.customGraph.findFirst({
        where: { id, projectId: project.id },
      });

      if (!graph) {
        return c.json({ error: "Graph not found" }, 404);
      }

      await prisma.customGraph.delete({
        where: { id, projectId: project.id },
      });

      return c.json({ id, deleted: true });
    },
  );
