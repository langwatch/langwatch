/**
 * Saved workbench charts under `/api/v1/projects/:projectId/analytics/charts`,
 * the addresses issue #6480 names. Literal: the family shares that prefix with
 * its siblings rather than owning it. Spec: specs — lwql-saved-charts.
 */
import {
  LangWatchQLNotEnabledError,
  createSavedWorkbenchChartSchema,
  langWatchQLCallerProtections,
  placeSavedWorkbenchChartSchema,
  savedWorkbenchChartListSchema,
  savedWorkbenchChartParamsSchema,
  savedWorkbenchChartProjectParamsSchema,
  savedWorkbenchChartSchema,
  updateSavedWorkbenchChartSchema,
} from "@langwatch/analytics-contract";
import {
  apiErrorSchema,
  canonicalBaseResponses,
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  resolver,
  type RestTransportDeclaration,
  type RouteResponse,
} from "@langwatch/api/rest";
import { DashboardApi, type SavedWorkbenchChart } from "@langwatch/dashboard-contract";
import { z } from "zod";

/**
 * The deep link back into the workbench for the project this credential
 * resolved. A fact, because the deployment's own origin is the process's answer
 * and not a module's.
 */
export const savedWorkbenchChartUrl = defineRestMiddleware("savedWorkbenchChartUrl", z.string());

/** The tags every operation in this file carries in the published document. */
const CHART_TAGS = ["Analytics / LangWatchQL"];

/**
 * The not-found answer every resource operation can give — a missing id and
 * another project's chart alike, deliberately indistinguishable.
 */
const chartNotFoundResponse: Record<404, RouteResponse> = {
  404: {
    description: "No chart with this id in this project",
    content: { "application/json": { schema: resolver(apiErrorSchema) } },
  },
};

/**
 * The project this request runs for: the credential's, once the surface has
 * been found switched on for it. The runtime has already refused a path naming
 * another project, so this guard is the only one left for a route to run.
 */
async function projectFor(input: { app: DashboardApi; scope: { id: string } }): Promise<string> {
  // Asked through the application rather than evaluated here: it is the one
  // place the flag is read, so this boundary and the workbench's cannot drift.
  if (!(await input.app.isWorkbenchEnabled({ projectId: input.scope.id }))) {
    throw new LangWatchQLNotEnabledError();
  }

  return input.scope.id;
}

/**
 * The chart as the API publishes it. Built field by field rather than spread:
 * the service's chart also carries `projectId`, which is the credential's and
 * tells a caller nothing it did not already send.
 */
function chartResource(
  chart: SavedWorkbenchChart,
  platformUrl: string,
): z.infer<typeof savedWorkbenchChartSchema> {
  return {
    id: chart.id,
    name: chart.name,
    definition: chart.definition,
    // Serialized here rather than left to `JSON.stringify`, so the response
    // matches the string the schema publishes by construction.
    createdAt: chart.createdAt.toISOString(),
    updatedAt: chart.updatedAt.toISOString(),
    platformUrl,
    dashboardId: chart.dashboardId,
    gridColumn: chart.gridColumn,
    gridRow: chart.gridRow,
    colSpan: chart.colSpan,
    rowSpan: chart.rowSpan,
  };
}

/**
 * The type is written out rather than inferred so the declaration emit
 * stays portable.
 */
export const savedWorkbenchChartRest: Readonly<{
  protocol: "rest";
  namespace: string;
  router: () => RestTransportDeclaration<DashboardApi>;
}> = defineRestRouter(DashboardApi)
  .withNamespace("saved-workbench-charts")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal")

  .get("/api/v1/projects/:projectId/analytics/charts", "getApiV1ProjectsByProjectIdAnalyticsCharts")
  .withParams(savedWorkbenchChartProjectParamsSchema)
  .withPermission("analytics:view")
  .withMiddleware(savedWorkbenchChartUrl)
  .withOutput(savedWorkbenchChartListSchema)
  .withDocs({
    summary: "List saved workbench charts",
    description:
      "Lists every saved LangWatchQL chart in this project, each with the statement it runs, the parameter values it was saved with and the Vega-Lite specification that draws it. Charts built with the chart builder are a different kind and are not listed here.",
    tags: CHART_TAGS,
    responses: {
      ...canonicalBaseResponses,
      200: {
        description: "The project's saved workbench charts",
        content: { "application/json": { schema: resolver(savedWorkbenchChartListSchema) } },
      },
    },
  })
  .handle(async ({ app, scope }, platformUrl) => {
    const projectId = await projectFor({ app, scope });
    const charts = await app.listSavedWorkbenchCharts({ projectId });

    return { data: charts.map((chart) => chartResource(chart, platformUrl)) };
  })

  .post(
    "/api/v1/projects/:projectId/analytics/charts",
    "postApiV1ProjectsByProjectIdAnalyticsCharts",
  )
  .withParams(savedWorkbenchChartProjectParamsSchema)
  .withInput(createSavedWorkbenchChartSchema)
  .withPermission("analytics:create")
  .withMiddleware(savedWorkbenchChartUrl, langWatchQLCallerProtections)
  .withOutput(savedWorkbenchChartSchema)
  .withStatus(201)
  .withDocs({
    summary: "Save a workbench chart",
    description:
      "Saves a LangWatchQL statement, its bound parameter values and an optional Vega-Lite specification as one chart. The statement is validated by the LangWatchQL analytics SQL validator against this key's own permissions, and the specification by the visualization policy, before anything is written — a chart that could not be run or drawn is refused rather than stored.",
    tags: CHART_TAGS,
    responses: {
      ...canonicalBaseResponses,
      201: {
        description: "The chart was saved",
        content: { "application/json": { schema: resolver(savedWorkbenchChartSchema) } },
      },
    },
  })
  .handle(async ({ app, input, scope }, platformUrl, protections) => {
    const projectId = await projectFor({ app, scope });
    const chart = await app.createSavedWorkbenchChart({
      projectId,
      protections,
      name: input.name,
      definition: input.definition,
    });

    return chartResource(chart, platformUrl);
  })

  .get(
    "/api/v1/projects/:projectId/analytics/charts/:chartId",
    "getApiV1ProjectsByProjectIdAnalyticsChartsByChartId",
  )
  .withParams(savedWorkbenchChartParamsSchema)
  .withPermission("analytics:view")
  .withMiddleware(savedWorkbenchChartUrl)
  .withOutput(savedWorkbenchChartSchema)
  .withDocs({
    summary: "Get a saved workbench chart",
    description:
      "Returns one saved LangWatchQL chart with its statement, parameter values and specification. A chart saved in another project is reported as not found.",
    tags: CHART_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...chartNotFoundResponse,
      200: {
        description: "The saved chart",
        content: { "application/json": { schema: resolver(savedWorkbenchChartSchema) } },
      },
    },
  })
  .handle(async ({ app, input, scope }, platformUrl) => {
    const projectId = await projectFor({ app, scope });
    const chart = await app.getSavedWorkbenchChart({ chartId: input.chartId, projectId });

    return chartResource(chart, platformUrl);
  })

  .patch(
    "/api/v1/projects/:projectId/analytics/charts/:chartId",
    "patchApiV1ProjectsByProjectIdAnalyticsChartsByChartId",
  )
  .withParams(savedWorkbenchChartParamsSchema)
  .withInput(updateSavedWorkbenchChartSchema)
  .withPermission("analytics:update")
  .withMiddleware(savedWorkbenchChartUrl, langWatchQLCallerProtections)
  .withOutput(savedWorkbenchChartSchema)
  .withDocs({
    summary: "Update a saved workbench chart",
    description:
      "Replaces a saved chart's name, its definition, or both. A definition offered here passes exactly the validators a save passes, resolved against this key's current permissions — so a chart cannot be edited into naming a column the caller may no longer read. A request carrying neither field is refused.",
    tags: CHART_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...chartNotFoundResponse,
      200: {
        description: "The updated chart",
        content: { "application/json": { schema: resolver(savedWorkbenchChartSchema) } },
      },
    },
  })
  .handle(async ({ app, input, scope }, platformUrl, protections) => {
    const projectId = await projectFor({ app, scope });
    const { name, definition } = input;
    const chart = await app.updateSavedWorkbenchChart({
      chartId: input.chartId,
      projectId,
      ...(name === undefined ? {} : { name }),
      ...(definition === undefined ? {} : { definitionUpdate: { definition, protections } }),
    });

    return chartResource(chart, platformUrl);
  })

  .delete(
    "/api/v1/projects/:projectId/analytics/charts/:chartId",
    "deleteApiV1ProjectsByProjectIdAnalyticsChartsByChartId",
  )
  .withParams(savedWorkbenchChartParamsSchema)
  .withPermission("analytics:delete")
  .withDocs({
    summary: "Delete a saved workbench chart",
    description:
      "Deletes one saved LangWatchQL chart. Answers 204 with no body; deleting a chart that is not in this project is reported as not found.",
    tags: CHART_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...chartNotFoundResponse,
      204: { description: "The chart was deleted", content: {} },
    },
  })
  .handle(async ({ app, input, scope }) => {
    const projectId = await projectFor({ app, scope });

    await app.deleteSavedWorkbenchChart({ chartId: input.chartId, projectId });
  })

  .put(
    "/api/v1/projects/:projectId/analytics/charts/:chartId/placement",
    "putApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacement",
  )
  .withParams(savedWorkbenchChartParamsSchema)
  .withInput(placeSavedWorkbenchChartSchema)
  .withPermission("analytics:update")
  .withMiddleware(savedWorkbenchChartUrl)
  .withOutput(savedWorkbenchChartSchema)
  .withDocs({
    summary: "Place a saved workbench chart on a dashboard",
    description:
      "Places one saved LangWatchQL chart on a dashboard in the same project, at the grid position supplied — or, when no grid row is given, at the next row free on that dashboard, counting charts of every kind. A dashboard that is not in this project is reported as not found, exactly like a chart that is not, and nothing is written.",
    tags: CHART_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...chartNotFoundResponse,
      200: {
        description: "The chart, now placed",
        content: { "application/json": { schema: resolver(savedWorkbenchChartSchema) } },
      },
    },
  })
  .handle(async ({ app, input, scope }, platformUrl) => {
    const projectId = await projectFor({ app, scope });
    const { projectId: _requested, chartId, ...placement } = input;
    const chart = await app.placeSavedWorkbenchChart({ projectId, chartId, ...placement });

    return chartResource(chart, platformUrl);
  })

  .delete(
    "/api/v1/projects/:projectId/analytics/charts/:chartId/placement",
    "deleteApiV1ProjectsByProjectIdAnalyticsChartsByChartIdPlacement",
  )
  .withParams(savedWorkbenchChartParamsSchema)
  .withPermission("analytics:update")
  .withDocs({
    summary: "Remove a saved workbench chart from its dashboard",
    description:
      "Removes one saved LangWatchQL chart from whatever dashboard it is on, clearing its grid position along with the dashboard id. Idempotent: unplacing a chart that is not placed answers 204 all the same. The chart itself — its statement, parameter values and specification — is untouched.",
    tags: CHART_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...chartNotFoundResponse,
      204: { description: "The chart is no longer on any dashboard", content: {} },
    },
  })
  .handle(async ({ app, input, scope }) => {
    const projectId = await projectFor({ app, scope });

    await app.unplaceSavedWorkbenchChart({ chartId: input.chartId, projectId });
  })
  .build();
