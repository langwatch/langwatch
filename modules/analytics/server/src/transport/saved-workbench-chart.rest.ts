/**
 * Saved workbench charts under `/api/v1/projects/:projectId/analytics/charts`,
 * the addresses issue #6480 names. Literal: the family shares that prefix with
 * its siblings rather than owning it. Spec: specs — lwql-saved-charts.
 */
import {
  LangWatchQLNotEnabledError,
  type LangWatchQLProtections,
} from "@langwatch/analytics-contract";
import {
  apiErrorSchema,
  canonicalBaseResponses,
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  resolver,
  type RouteResponse,
} from "@langwatch/api/rest";
import type { SavedWorkbenchChart } from "@langwatch/dashboard-contract";
import { moduleApi } from "@langwatch/runtime-composition";
import { z } from "zod";

import { langWatchQLCallerProtections } from "./query.rest.ts";

/**
 * What this family reaches. A saved workbench chart is a DASHBOARD resource with
 * a dashboard lifecycle, so its operations arrive from the process.
 */
export interface SavedWorkbenchChartApi {
  /** The experimental gate over the whole surface, asked per request. */
  isWorkbenchEnabled(input: { projectId: string }): Promise<boolean>;
  listSavedWorkbenchCharts(input: { projectId: string }): Promise<SavedWorkbenchChart[]>;
  getSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
  }): Promise<SavedWorkbenchChart>;
  createSavedWorkbenchChart(input: {
    projectId: string;
    protections: LangWatchQLProtections;
    name: string;
    definition: unknown;
  }): Promise<SavedWorkbenchChart>;
  updateSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    name?: string;
    definitionUpdate?: { definition: unknown; protections: LangWatchQLProtections };
  }): Promise<SavedWorkbenchChart>;
  deleteSavedWorkbenchChart(input: { projectId: string; chartId: string }): Promise<void>;
  placeSavedWorkbenchChart(input: {
    projectId: string;
    chartId: string;
    dashboardId: string;
    gridColumn?: number;
    gridRow?: number;
    colSpan?: number;
    rowSpan?: number;
  }): Promise<SavedWorkbenchChart>;
  unplaceSavedWorkbenchChart(input: { projectId: string; chartId: string }): Promise<void>;
}

export const SavedWorkbenchChartApi = moduleApi<SavedWorkbenchChartApi>("analytics");

/**
 * The deep link back into the workbench for the project this credential
 * resolved. A fact, because the deployment's own origin is the process's answer
 * and not a module's.
 */
export const savedWorkbenchChartUrl = defineRestMiddleware("savedWorkbenchChartUrl", z.string());

/**
 * The Vega-Lite specification ceiling this route derives its own from. STATED
 * here rather than imported.
 * @see modules/analytics/contract/src/visualization/vega-lite-policy.ts
 */
const MAX_VEGA_SPEC_BYTES = 262_144;

/** Longest definition this endpoint accepts, in UTF-8 bytes of its JSON. */
const MAX_CHART_DEFINITION_BYTES = MAX_VEGA_SPEC_BYTES + 65_536;

/**
 * The serialized size of a definition in UTF-8 bytes, or `null` when it cannot
 * be serialized at all. The same measurement the visualization policy makes of
 * its own ceiling, so this route and that one are in the same unit.
 */
function measureSpecBytes(spec: unknown): number | null {
  try {
    const json = JSON.stringify(spec);

    if (json === undefined) return null;

    return new TextEncoder().encode(json).length;
  } catch {
    return null;
  }
}

/** Request shape only — a length, not a meaning. Matches the tRPC surface. */
const nameSchema = z.string().min(1).max(200);

/**
 * The definition: bounded, and otherwise untouched. Its shape belongs to the
 * service's versioned schema, and a second copy here would drift from it.
 */
const definitionSchema = z.unknown().superRefine((definition, ctx) => {
  // `z.unknown()` is satisfied by an absent key. A create that omits the
  // definition is the service's refusal to give, not a size one.
  if (definition === undefined) return;

  const bytes = measureSpecBytes(definition);

  if (bytes !== null && bytes <= MAX_CHART_DEFINITION_BYTES) return;

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: `Chart definition must serialize to at most ${MAX_CHART_DEFINITION_BYTES} bytes.`,
  });
});

/** A placement request's envelope: a dashboard id, and an optional grid position. */
const placeChartSchema = z.object({
  dashboardId: z.string().min(1),
  gridColumn: z.number().int().optional(),
  gridRow: z.number().int().optional(),
  colSpan: z.number().int().optional(),
  rowSpan: z.number().int().optional(),
});

const createChartSchema = z.object({ name: nameSchema, definition: definitionSchema });

const updateChartSchema = z
  .object({ name: nameSchema.optional(), definition: definitionSchema.optional() })
  // A PATCH naming neither field is a mistake worth reporting: answering 200
  // with an untouched chart tells an integrator their update was applied.
  .refine(
    (body) => body.name !== undefined || body.definition !== undefined,
    "Provide a name, a definition, or both.",
  )
  // The refine above is what enforces this, but a refinement is opaque to the
  // spec generator: without this the published schema accepts `{}` while the
  // API refuses it, and a mock server built from the spec disagrees with the
  // real one.
  .meta({ minProperties: 1 });

// Response schemas exist for the published OpenAPI document. The service owns
// the types; these describe them to a consumer reading the spec, and stay loose
// exactly where the payload genuinely is the caller's.
const chartDefinitionSchema = z.object({
  version: z.number(),
  sql: z.string(),
  parameters: z.record(z.string(), z.any()),
  vegaLiteSpec: z.record(z.string(), z.any()).optional(),
});

const chartSchema = z.object({
  id: z.string(),
  name: z.string(),
  definition: chartDefinitionSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  platformUrl: z.string(),
  /** `null` when the chart has never been placed, or has been unplaced. */
  dashboardId: z.string().nullable(),
  gridColumn: z.number().int(),
  gridRow: z.number().int(),
  colSpan: z.number().int(),
  rowSpan: z.number().int(),
});

const chartListSchema = z.object({ data: z.array(chartSchema) });

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

const projectParamsSchema = z.object({ projectId: z.string().min(1) });
const chartParamsSchema = z.object({
  ...projectParamsSchema.shape,
  chartId: z.string().min(1),
});

/**
 * The project this request runs for: the credential's, once the surface has
 * been found switched on for it. The runtime has already refused a path naming
 * another project, so this guard is the only one left for a route to run.
 */
async function projectFor(input: {
  app: SavedWorkbenchChartApi;
  scope: { id: string };
}): Promise<string> {
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
): z.infer<typeof chartSchema> {
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

export const savedWorkbenchChartRest = defineRestRouter(SavedWorkbenchChartApi)
  .withNamespace("saved-workbench-charts")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal")

  .get("/api/v1/projects/:projectId/analytics/charts", "getApiV1ProjectsByProjectIdAnalyticsCharts")
  .withParams(projectParamsSchema)
  .withPermission("analytics:view")
  .withMiddleware(savedWorkbenchChartUrl)
  .withOutput(chartListSchema)
  .withDocs({
    summary: "List saved workbench charts",
    description:
      "Lists every saved LangWatchQL chart in this project, each with the statement it runs, the parameter values it was saved with and the Vega-Lite specification that draws it. Charts built with the chart builder are a different kind and are not listed here.",
    tags: CHART_TAGS,
    responses: {
      ...canonicalBaseResponses,
      200: {
        description: "The project's saved workbench charts",
        content: { "application/json": { schema: resolver(chartListSchema) } },
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
  .withParams(projectParamsSchema)
  .withInput(createChartSchema)
  .withPermission("analytics:create")
  .withMiddleware(savedWorkbenchChartUrl, langWatchQLCallerProtections)
  .withOutput(chartSchema)
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
        content: { "application/json": { schema: resolver(chartSchema) } },
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
  .withParams(chartParamsSchema)
  .withPermission("analytics:view")
  .withMiddleware(savedWorkbenchChartUrl)
  .withOutput(chartSchema)
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
        content: { "application/json": { schema: resolver(chartSchema) } },
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
  .withParams(chartParamsSchema)
  .withInput(updateChartSchema)
  .withPermission("analytics:update")
  .withMiddleware(savedWorkbenchChartUrl, langWatchQLCallerProtections)
  .withOutput(chartSchema)
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
        content: { "application/json": { schema: resolver(chartSchema) } },
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
  .withParams(chartParamsSchema)
  .withPermission("analytics:delete")
  .withDocs({
    summary: "Delete a saved workbench chart",
    description:
      "Deletes one saved LangWatchQL chart. Answers 204 with no body; deleting a chart that is not in this project is reported as not found.",
    tags: CHART_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...chartNotFoundResponse,
      204: { description: "The chart was deleted" },
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
  .withParams(chartParamsSchema)
  .withInput(placeChartSchema)
  .withPermission("analytics:update")
  .withMiddleware(savedWorkbenchChartUrl)
  .withOutput(chartSchema)
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
        content: { "application/json": { schema: resolver(chartSchema) } },
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
  .withParams(chartParamsSchema)
  .withPermission("analytics:update")
  .withDocs({
    summary: "Remove a saved workbench chart from its dashboard",
    description:
      "Removes one saved LangWatchQL chart from whatever dashboard it is on, clearing its grid position along with the dashboard id. Idempotent: unplacing a chart that is not placed answers 204 all the same. The chart itself — its statement, parameter values and specification — is untouched.",
    tags: CHART_TAGS,
    responses: {
      ...canonicalBaseResponses,
      ...chartNotFoundResponse,
      204: { description: "The chart is no longer on any dashboard" },
    },
  })
  .handle(async ({ app, input, scope }) => {
    const projectId = await projectFor({ app, scope });

    await app.unplaceSavedWorkbenchChart({ chartId: input.chartId, projectId });
  })
  .build();
