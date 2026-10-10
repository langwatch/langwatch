/**
 * REST for the custom graphs a dashboard is built from, under `/api/graphs`.
 * The two timestamps leave as ISO strings, as this family has always sent them.
 * A graph posted without a size is 1 by 1 here, as on main; tRPC's default is 4 by 3.
 */
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  DashboardApi,
  graphDeletedResponseSchema,
  graphListRestResponseSchema,
  graphRestCreateSchema,
  graphRestListQuerySchema,
  graphRestParamsSchema,
  graphRestResponseSchema,
  graphRestUpdateSchema,
  type Graph,
} from "@langwatch/dashboard-contract";

import { viewerOfActor } from "../rules/dashboard-viewer.rules.ts";

const graphResponse = (graph: Graph) => ({
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
});

export const graphRest = defineRestRouter(DashboardApi)
  .withNamespace("graphs")
  .withVersion(MANAGEMENT_API_VERSION)

  .get("/", "getApiGraphs")
  .withQuery(graphRestListQuerySchema)
  .withPermission("analytics:view")
  .withOutput(graphListRestResponseSchema)
  .withDocs({
    tags: ["Graphs"],
    description: "List all custom graphs, optionally filtered by dashboard",
  })
  .handle(async ({ app, input, scope, actor }) => {
    const graphs = await app.listGraphs({
      projectId: scope.id,
      ...viewerOfActor({ actor }),
      ...(input.dashboardId === undefined ? {} : { dashboardId: input.dashboardId }),
    });

    return graphs.map((graph) => graphResponse(graph));
  })

  .get("/:id", "getApiGraphsById")
  .withParams(graphRestParamsSchema)
  .withPermission("analytics:view")
  .withOutput(graphRestResponseSchema)
  .withDocs({ tags: ["Graphs"], description: "Get a custom graph by its ID" })
  .handle(async ({ app, input, scope, actor }) =>
    graphResponse(
      await app.getGraph({ projectId: scope.id, graphId: input.id, ...viewerOfActor({ actor }) }),
    ),
  )

  // Creating asks for `analytics:create`; `:manage` still implies it.
  .post("/", "postApiGraphs")
  .withInput(graphRestCreateSchema)
  .withPermission("analytics:create")
  .withOutput(graphRestResponseSchema)
  .withStatus(201)
  .withDocs({ tags: ["Graphs"], description: "Create a custom graph on a dashboard" })
  .handle(async ({ app, input, scope, actor }) =>
    graphResponse(
      await app.createGraph({
        projectId: scope.id,
        ...viewerOfActor({ actor }),
        name: input.name,
        graph: input.graph,
        ...(input.filters === undefined ? {} : { filters: input.filters }),
        ...(input.dashboardId === undefined ? {} : { dashboardId: input.dashboardId }),
        layout: {
          ...(input.gridColumn === undefined ? {} : { gridColumn: input.gridColumn }),
          ...(input.gridRow === undefined ? {} : { gridRow: input.gridRow }),
          colSpan: input.colSpan ?? 1,
          rowSpan: input.rowSpan ?? 1,
        },
      }),
    ),
  )

  .patch("/:id", "patchApiGraphsById")
  .withParams(graphRestParamsSchema)
  .withInput(graphRestUpdateSchema)
  .withPermission("analytics:update")
  .withOutput(graphRestResponseSchema)
  .withDocs({
    tags: ["Graphs"],
    description: "Update a custom graph's name, definition, or filters",
  })
  .handle(async ({ app, input, scope, actor }) =>
    graphResponse(
      await app.updateGraph({
        projectId: scope.id,
        graphId: input.id,
        ...viewerOfActor({ actor }),
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.graph === undefined ? {} : { graph: input.graph }),
        ...(input.filters === undefined ? {} : { filters: input.filters }),
      }),
    ),
  )

  // Destruction deliberately stays at `:manage`.
  .delete("/:id", "deleteApiGraphsById")
  .withParams(graphRestParamsSchema)
  .withPermission("analytics:manage")
  .withOutput(graphDeletedResponseSchema)
  .withDocs({ tags: ["Graphs"], description: "Delete a custom graph" })
  .handle(async ({ app, input, scope, actor }) => {
    await app.deleteGraph({ projectId: scope.id, graphId: input.id, ...viewerOfActor({ actor }) });

    return { id: input.id, deleted: true };
  })
  .build();
