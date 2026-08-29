import { requires } from "@langwatch/api";
import {
  type AppRestProjectVariables,
  type AppRestSecurity,
  badRequestSchema,
  baseResponses,
  type SecuredApp,
  validator as zValidator,
} from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import {
  DashboardNotThereError,
  GraphNotThereError,
  type DashboardApp,
} from "#app/dashboard.app";

const logger = createLogger("langwatch:api:graphs");

const graphResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  graph: z.record(z.string(), z.unknown()),
  filters: z.record(z.string(), z.unknown()).nullable(),
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
  graph: z.record(z.string(), z.unknown()),
  dashboardId: z.string().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
  gridColumn: z.number().min(0).max(1).optional(),
  gridRow: z.number().min(0).optional(),
  colSpan: z.number().min(1).max(2).optional(),
  rowSpan: z.number().min(1).max(2).optional(),
});

const updateGraphSchema = z.object({
  name: z.string().min(1).optional(),
  graph: z.record(z.string(), z.unknown()).optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
});

function toGraphResponse(graph: {
  id: string;
  name: string;
  graph: Record<string, unknown>;
  filters: Record<string, unknown> | null;
  dashboardId: string | null;
  gridColumn: number;
  gridRow: number;
  colSpan: number;
  rowSpan: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: graph.id,
    name: graph.name,
    graph: graph.graph,
    filters: graph.filters,
    dashboardId: graph.dashboardId,
    gridColumn: graph.gridColumn,
    gridRow: graph.gridRow,
    colSpan: graph.colSpan,
    rowSpan: graph.rowSpan,
    createdAt: graph.createdAt.toISOString(),
    updatedAt: graph.updatedAt.toISOString(),
  };
}

/**
 * REST for the custom graphs a dashboard is built from.
 *
 * The application arrives as a provider rather than being read off the
 * request, so this family can be mounted into any process that has one. It is
 * the SAME {@link DashboardApp} the tRPC surfaces are given, which is what lets
 * the handlers below recognise a refusal by its class instead of by comparing
 * `error.name` to a string literal.
 */
export function createGraphsRestApp(options: {
  security: AppRestSecurity;
  /**
   * Resolved per request, as reading it off the Hono context used to be:
   * mounting a family must not force its services to be constructed, which is
   * what lets the OpenAPI spec generator build this app with none.
   */
  dashboard: () => DashboardApp;
}): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const { security, dashboard } = options;

  const secured = security.createProjectApp({
    basePath: "/api/graphs",
  });

  // ── List Graphs ────────────────────────────────────────────
  secured.access(requires("analytics:view")).get(
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
    zValidator(
      "query",
      z.object({
        dashboardId: z.string().optional(),
      }),
    ),
    async (c) => {
      const project = c.get("project");
      const { dashboardId } = c.req.valid("query");
      logger.info({ projectId: project.id, dashboardId }, "Listing graphs");

      const graphs = await dashboard().listGraphs({
        projectId: project.id,
        ...(dashboardId === undefined ? {} : { dashboardId }),
      });

      return c.json(graphs.map(toGraphResponse));
    },
  );

  // ── Get Graph ──────────────────────────────────────────────
  secured.access(requires("analytics:view")).get(
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

      try {
        const graph = await dashboard().getGraph({
          projectId: project.id,
          graphId: id,
        });
        return c.json(toGraphResponse(graph));
      } catch (error) {
        if (error instanceof GraphNotThereError) {
          return c.json({ error: "Graph not found" }, 404);
        }
        throw error;
      }
    },
  );

  // ── Create Graph ───────────────────────────────────────────
  // Creating asks for `analytics:create`; `:manage` still implies it.
  secured.access(requires("analytics:create")).post(
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

      let graph;
      try {
        graph = await dashboard().createGraph({
          projectId: project.id,
          name: body.name,
          graph: body.graph,
          ...(body.filters === undefined ? {} : { filters: body.filters }),
          ...(body.dashboardId === undefined ? {} : { dashboardId: body.dashboardId }),
          layout: {
            ...(body.gridColumn === undefined ? {} : { gridColumn: body.gridColumn }),
            ...(body.gridRow === undefined ? {} : { gridRow: body.gridRow }),
            ...(body.colSpan === undefined ? {} : { colSpan: body.colSpan }),
            ...(body.rowSpan === undefined ? {} : { rowSpan: body.rowSpan }),
          },
        });
      } catch (error) {
        if (error instanceof DashboardNotThereError) {
          return c.json({ error: "Dashboard not found" }, 404);
        }
        throw error;
      }

      return c.json(toGraphResponse(graph), 201);
    },
  );

  // ── Update Graph ───────────────────────────────────────────
  secured.access(requires("analytics:update")).patch(
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

      let updated;
      try {
        updated = await dashboard().updateGraph({
          projectId: project.id,
          graphId: id,
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.graph === undefined ? {} : { graph: body.graph }),
          ...(body.filters === undefined ? {} : { filters: body.filters }),
        });
      } catch (error) {
        if (error instanceof GraphNotThereError) {
          return c.json({ error: "Graph not found" }, 404);
        }
        throw error;
      }

      return c.json(toGraphResponse(updated));
    },
  );

  // ── Delete Graph ───────────────────────────────────────────
  // Destruction deliberately stays at `:manage`.
  secured.access(requires("analytics:manage")).delete(
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

      try {
        await dashboard().deleteGraph({ projectId: project.id, graphId: id });
      } catch (error) {
        if (error instanceof GraphNotThereError) {
          return c.json({ error: "Graph not found" }, 404);
        }
        throw error;
      }

      return c.json({ id, deleted: true });
    },
  );

  return secured;
}
