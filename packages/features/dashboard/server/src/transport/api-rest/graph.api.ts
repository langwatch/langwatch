import {
  type AppRestSecurity,
  baseResponses,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  type ProjectScopedContext,
  type RestErrorHandler,
  projectOf,
  type RouteResponse,
} from "@langwatch/api/rest";
import {
  graphDeletedResponseSchema,
  graphListRestResponseSchema,
  graphRestResponseSchema,
} from "@langwatch/dashboard-contract";
import { isZodLikeError, ValidationError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import { DashboardNotThereError, GraphNotThereError, type DashboardApp } from "#app/dashboard.app";

const logger = createLogger("langwatch:api:graphs");

/**
 * The family's own refusals, in the bare `{ error }` body they have always
 * had. Everything else goes to the boundary, zod rejections promoted so a
 * rejected body stays a 422.
 */
const graphErrorHandler =
  (boundary: RestErrorHandler): RestErrorHandler =>
  (error, c) => {
    if (error instanceof GraphNotThereError) {
      return c.json({ error: "Graph not found" }, 404);
    }
    if (error instanceof DashboardNotThereError) {
      return c.json({ error: "Dashboard not found" }, 404);
    }
    return boundary(isZodLikeError(error) ? ValidationError.fromZodError(error) : error, c);
  };

const listGraphsQuerySchema = z.object({ dashboardId: z.string().optional() });

const graphIdParamsSchema = z.object({ id: z.string().min(1) });

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
 * the family's error handler recognise a refusal by its class.
 */
export function createGraphsRestApp(options: {
  security: AppRestSecurity;
  /**
   * Resolved per request, as reading it off the Hono context used to be:
   * mounting a family must not force its services to be constructed, which is
   * what lets the OpenAPI spec generator build this app with none.
   */
  dashboard: () => DashboardApp;
}): MountableRestApp {
  const { security, dashboard } = options;

  const { service, policy } = security.createProjectVersionedApp({
    name: "graphs",
    basePath: "/api/graphs",
    errorEnvelope: "legacy",
    errorHandler: graphErrorHandler,
  });

  type GraphContext = ProjectScopedContext<EndpointVariables>;

  const listGraphsHandler = async (
    c: GraphContext,
    input: z.infer<typeof listGraphsQuerySchema>,
  ) => {
    const project = projectOf(c);
    logger.info({ projectId: project.id, dashboardId: input.dashboardId }, "Listing graphs");

    const graphs = await dashboard().listGraphs({
      projectId: project.id,
      ...(input.dashboardId === undefined ? {} : { dashboardId: input.dashboardId }),
    });

    return graphs.map(toGraphResponse);
  };

  const getGraphHandler = async (c: GraphContext, input: z.infer<typeof graphIdParamsSchema>) => {
    const project = projectOf(c);

    const graph = await dashboard().getGraph({ projectId: project.id, graphId: input.id });
    return toGraphResponse(graph);
  };

  const createGraphHandler = async (c: GraphContext, input: z.infer<typeof createGraphSchema>) => {
    const project = projectOf(c);
    logger.info({ projectId: project.id }, "Creating graph");

    const graph = await dashboard().createGraph({
      projectId: project.id,
      name: input.name,
      graph: input.graph,
      ...(input.filters === undefined ? {} : { filters: input.filters }),
      ...(input.dashboardId === undefined ? {} : { dashboardId: input.dashboardId }),
      layout: {
        ...(input.gridColumn === undefined ? {} : { gridColumn: input.gridColumn }),
        ...(input.gridRow === undefined ? {} : { gridRow: input.gridRow }),
        ...(input.colSpan === undefined ? {} : { colSpan: input.colSpan }),
        ...(input.rowSpan === undefined ? {} : { rowSpan: input.rowSpan }),
      },
    });

    return toGraphResponse(graph);
  };

  const updateGraphHandler = async (
    c: GraphContext,
    input: z.infer<typeof graphIdParamsSchema> & z.infer<typeof updateGraphSchema>,
  ) => {
    const project = projectOf(c);

    const updated = await dashboard().updateGraph({
      projectId: project.id,
      graphId: input.id,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.graph === undefined ? {} : { graph: input.graph }),
      ...(input.filters === undefined ? {} : { filters: input.filters }),
    });

    return toGraphResponse(updated);
  };

  const deleteGraphHandler = async (
    c: GraphContext,
    input: z.infer<typeof graphIdParamsSchema>,
  ) => {
    const project = projectOf(c);

    await dashboard().deleteGraph({ projectId: project.id, graphId: input.id });

    return { id: input.id, deleted: true };
  };

  /** The 404 body this family answers, documented as the shape it really is. */
  const graphNotFoundResponse: Record<404, RouteResponse> = {
    404: {
      description: "Graph not found",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
  };

  return (
    service
      .registerRoute("get", "/", MANAGEMENT_API_VERSION, listGraphsHandler, (b) =>
        policy("analytics:view")(b)
          .withQuery(listGraphsQuerySchema)
          .withOutput(graphListRestResponseSchema)
          .withDocs({
            operationId: "listGraphs",
            tags: ["Graphs"],
            description: "List all custom graphs, optionally filtered by dashboard",
            responses: baseResponses,
          }),
      )
      .registerRoute("get", "/:id", MANAGEMENT_API_VERSION, getGraphHandler, (b) =>
        policy("analytics:view")(b)
          .withParams(graphIdParamsSchema)
          .withOutput(graphRestResponseSchema)
          .withDocs({
            operationId: "getGraph",
            tags: ["Graphs"],
            description: "Get a custom graph by its ID",
            responses: { ...baseResponses, ...graphNotFoundResponse },
          }),
      )
      // Creating asks for `analytics:create`; `:manage` still implies it.
      .registerRoute("post", "/", MANAGEMENT_API_VERSION, createGraphHandler, (b) =>
        policy("analytics:create")(b)
          .withInput(createGraphSchema)
          .withOutput(graphRestResponseSchema)
          .withStatus(201)
          .withDocs({
            operationId: "createGraph",
            tags: ["Graphs"],
            description: "Create a custom graph on a dashboard",
            responses: baseResponses,
          }),
      )
      .registerRoute("patch", "/:id", MANAGEMENT_API_VERSION, updateGraphHandler, (b) =>
        policy("analytics:update")(b)
          .withParams(graphIdParamsSchema)
          .withInput(updateGraphSchema)
          .withOutput(graphRestResponseSchema)
          .withDocs({
            operationId: "updateGraph",
            tags: ["Graphs"],
            description: "Update a custom graph's name, definition, or filters",
            responses: { ...baseResponses, ...graphNotFoundResponse },
          }),
      )
      // Destruction deliberately stays at `:manage`.
      .registerRoute("delete", "/:id", MANAGEMENT_API_VERSION, deleteGraphHandler, (b) =>
        policy("analytics:manage")(b)
          .withParams(graphIdParamsSchema)
          .withOutput(graphDeletedResponseSchema)
          .withDocs({
            operationId: "deleteGraph",
            tags: ["Graphs"],
            description: "Delete a custom graph",
            responses: { ...baseResponses, ...graphNotFoundResponse },
          }),
      )
      .build()
  );
}
