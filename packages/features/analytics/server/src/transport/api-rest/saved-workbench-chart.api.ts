/**
 * Saved workbench charts — the REST routes.
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { requires } from "@langwatch/api";
import {
  apiErrorSchema,
  canonicalBaseResponses,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  projectOf,
  type ProjectScopedContext,
  resolver,
  type RestApiVersionedFamily,
  type RouteResponse,
} from "@langwatch/api/rest";
import type { SavedWorkbenchChart } from "@langwatch/dashboard-contract";
import type { ProjectIdentity } from "@langwatch/project-contract";
import { z } from "zod";

import {
  type LangWatchQLRestPorts,
  LangWatchQLRouteGuardsService,
} from "../../services/langwatch-ql-route-guards.service.ts";

const routeGuards = LangWatchQLRouteGuardsService.create();

/** The handler context every route in this family runs on. */
type ChartContext = ProjectScopedContext<EndpointVariables>;

/**
 * The Vega-Lite specification ceiling this route derives its own from. STATED here rather than
 * imported.
 * @see packages/features/analytics/contract/src/visualization/vega-lite-policy.ts
 */
const MAX_VEGA_SPEC_BYTES = 262_144;

/**
 * The serialized size of a definition in UTF-8 bytes, or `null` when it cannot be serialized at
 * all. The same measurement the visualization policy makes of its own ceiling, so this route
 * and that one are in the same unit.
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
 * Longest definition this endpoint accepts, in UTF-8 bytes of its JSON.
 */
const MAX_CHART_DEFINITION_BYTES = MAX_VEGA_SPEC_BYTES + 65_536;

/**
 * The definition: bounded, and otherwise untouched. `unknown` is the honest declaration of its
 * shape — that belongs to the service's versioned schema, and a definition this route rejected
 * on shape would be rejected by a second, drifting copy of that decision.
 */
const definitionSchema = z.unknown().superRefine((definition, ctx) => {
  // `z.unknown()` is satisfied by an absent key. A create that omits the
  // definition is the service's refusal to give, not a size one.
  if (definition === undefined) return;

  // Measured the way the visualization policy measures its own ceiling, so the
  // two are in the same unit. `null` is "could not be serialized at all", which
  // is a refusal rather than "small enough".
  const bytes = measureSpecBytes(definition);
  if (bytes !== null && bytes <= MAX_CHART_DEFINITION_BYTES) return;

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: `Chart definition must serialize to at most ${MAX_CHART_DEFINITION_BYTES} bytes.`,
  });
});

/**
 * A placement request's envelope: a dashboard id, and an optional grid position.
 */
const placeChartSchema = z.object({
  dashboardId: z.string().min(1),
  gridColumn: z.number().int().optional(),
  gridRow: z.number().int().optional(),
  colSpan: z.number().int().optional(),
  rowSpan: z.number().int().optional(),
});

const createChartSchema = z.object({
  name: nameSchema,
  definition: definitionSchema,
});

const updateChartSchema = z
  .object({
    name: nameSchema.optional(),
    definition: definitionSchema.optional(),
  })
  // A PATCH naming neither field is a mistake worth reporting: answering 200
  // with an untouched chart tells an integrator their update was applied.
  .refine(
    (body) => body.name !== undefined || body.definition !== undefined,
    "Provide a name, a definition, or both.",
  )
  // The refine above is what enforces this, but a refinement is opaque to the
  // spec generator: without this the published schema accepts `{}` while the
  // API refuses it, and a mock server built from the spec disagrees with the
  // real one. Stated here so the emitted document carries the same rule.
  .meta({ minProperties: 1 });

// Response schemas exist for the published OpenAPI document. The service owns
// the types; these describe them to a consumer reading the spec, and stay loose
// exactly where the payload genuinely is the caller's (the Vega-Lite
// specification, and the parameter values a statement declares).
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
 * The not-found answer every resource operation can give — a missing id and another project's
 * chart alike, deliberately indistinguishable.
 */
const chartNotFoundResponse: Record<404, RouteResponse> = {
  404: {
    description: "No chart with this id in this project",
    content: { "application/json": { schema: resolver(apiErrorSchema) } },
  },
};

/**
 * The chart as the API publishes it. Built field by field rather than spread: the service's
 * chart also carries `projectId`, which is the credential's and tells a caller nothing it did
 * not already send.
 */
function chartResource({
  chart,
  project,
  ports,
}: {
  chart: SavedWorkbenchChart;
  project: ProjectIdentity;
  ports: LangWatchQLRestPorts;
}): z.infer<typeof chartSchema> {
  return {
    id: chart.id,
    name: chart.name,
    definition: chart.definition,
    // Serialized here rather than left to `JSON.stringify`, so the response
    // matches the string the schema publishes by construction.
    createdAt: chart.createdAt.toISOString(),
    updatedAt: chart.updatedAt.toISOString(),
    platformUrl: ports.platformUrl({
      projectSlug: project.slug,
      path: "/analytics/query",
    }),
    dashboardId: chart.dashboardId,
    gridColumn: chart.gridColumn,
    gridRow: chart.gridRow,
    colSpan: chart.colSpan,
    rowSpan: chart.rowSpan,
  };
}

async function dashboardSavedChartCall<T>(
  ports: LangWatchQLRestPorts,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    ports.mapSavedChartError(error);
  }
}

const projectParamsSchema = z.object({ projectId: z.string().min(1) });
const chartParamsSchema = projectParamsSchema.extend({ chartId: z.string().min(1) });

/**
 * Registers the saved workbench chart routes on the LangWatchQL analytics family.
 */
export function registerSavedWorkbenchChartRoutes(
  family: RestApiVersionedFamily,
  ports: LangWatchQLRestPorts,
): void {
  const { service, policy } = family;

  /**
   * The project the path names, once the guards have decided the caller may
   * address it. Every route in the family starts here.
   */
  const projectFor = async (c: ChartContext, requestedProjectId: string) =>
    await routeGuards.project({
      featureFlags: ports.featureFlags(),
      project: projectOf(c),
      projects: ports.projects(),
      requestedProjectId,
    });

  const listHandler = async (c: ChartContext, input: z.infer<typeof projectParamsSchema>) => {
    const project = await projectFor(c, input.projectId);
    const charts = await dashboardSavedChartCall(ports, () =>
      ports.charts().listSavedWorkbenchCharts({ projectId: project.id }),
    );
    return { data: charts.map((chart) => chartResource({ chart, project, ports })) };
  };

  const createHandler = async (
    c: ChartContext,
    input: z.infer<typeof projectParamsSchema> & z.infer<typeof createChartSchema>,
  ) => {
    const project = await projectFor(c, input.projectId);
    const protections = await ports.protectionsFor({ projectId: project.id });
    const chart = await dashboardSavedChartCall(ports, () =>
      ports.charts().createSavedWorkbenchChart({
        projectId: project.id,
        protections,
        name: input.name,
        definition: input.definition,
      }),
    );
    return chartResource({ chart, project, ports });
  };

  const readHandler = async (c: ChartContext, input: z.infer<typeof chartParamsSchema>) => {
    const project = await projectFor(c, input.projectId);
    const chart = await dashboardSavedChartCall(ports, () =>
      ports.charts().getSavedWorkbenchChart({ chartId: input.chartId, projectId: project.id }),
    );
    return chartResource({ chart, project, ports });
  };

  const updateHandler = async (
    c: ChartContext,
    input: z.infer<typeof chartParamsSchema> & z.infer<typeof updateChartSchema>,
  ) => {
    const project = await projectFor(c, input.projectId);
    const { name, definition } = input;
    const definitionUpdate =
      definition === undefined
        ? undefined
        : {
            definition,
            protections: await ports.protectionsFor({ projectId: project.id }),
          };
    const chart = await dashboardSavedChartCall(ports, () =>
      ports.charts().updateSavedWorkbenchChart({
        chartId: input.chartId,
        projectId: project.id,
        ...(name === undefined ? {} : { name }),
        ...(definitionUpdate === undefined ? {} : { definitionUpdate }),
      }),
    );
    return chartResource({ chart, project, ports });
  };

  const deleteHandler = async (c: ChartContext, input: z.infer<typeof chartParamsSchema>) => {
    const project = await projectFor(c, input.projectId);
    await dashboardSavedChartCall(ports, () =>
      ports.charts().deleteSavedWorkbenchChart({ chartId: input.chartId, projectId: project.id }),
    );
  };

  const placeHandler = async (
    c: ChartContext,
    input: z.infer<typeof chartParamsSchema> & z.infer<typeof placeChartSchema>,
  ) => {
    const project = await projectFor(c, input.projectId);
    const { projectId: _requested, chartId, ...placement } = input;
    const chart = await dashboardSavedChartCall(ports, () =>
      ports.charts().placeSavedWorkbenchChart({
        projectId: project.id,
        chartId,
        ...placement,
      }),
    );
    return chartResource({ chart, project, ports });
  };

  const unplaceHandler = async (c: ChartContext, input: z.infer<typeof chartParamsSchema>) => {
    const project = await projectFor(c, input.projectId);
    await dashboardSavedChartCall(ports, () =>
      ports.charts().unplaceSavedWorkbenchChart({ chartId: input.chartId, projectId: project.id }),
    );
  };

  service
    .registerRoute(
      "get",
      "/:projectId/analytics/charts",
      MANAGEMENT_API_VERSION,
      listHandler,
      (b) =>
        policy(requires("analytics:view"))(b)
          .withParams(projectParamsSchema)
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
          }),
    )
    .registerRoute(
      "post",
      "/:projectId/analytics/charts",
      MANAGEMENT_API_VERSION,
      createHandler,
      (b) =>
        policy(requires("analytics:create"))(b)
          .withParams(projectParamsSchema)
          .withInput(createChartSchema)
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
          }),
    )
    .registerRoute(
      "get",
      "/:projectId/analytics/charts/:chartId",
      MANAGEMENT_API_VERSION,
      readHandler,
      (b) =>
        policy(requires("analytics:view"))(b)
          .withParams(chartParamsSchema)
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
          }),
    )
    .registerRoute(
      "patch",
      "/:projectId/analytics/charts/:chartId",
      MANAGEMENT_API_VERSION,
      updateHandler,
      (b) =>
        policy(requires("analytics:update"))(b)
          .withParams(chartParamsSchema)
          .withInput(updateChartSchema)
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
          }),
    )
    .registerRoute(
      "delete",
      "/:projectId/analytics/charts/:chartId",
      MANAGEMENT_API_VERSION,
      deleteHandler,
      (b) =>
        policy(requires("analytics:delete"))(b)
          .withParams(chartParamsSchema)
          .withOutput(z.void())
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
          }),
    )
    .registerRoute(
      "put",
      "/:projectId/analytics/charts/:chartId/placement",
      MANAGEMENT_API_VERSION,
      placeHandler,
      (b) =>
        policy(requires("analytics:update"))(b)
          .withParams(chartParamsSchema)
          .withInput(placeChartSchema)
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
          }),
    )
    .registerRoute(
      "delete",
      "/:projectId/analytics/charts/:chartId/placement",
      MANAGEMENT_API_VERSION,
      unplaceHandler,
      (b) =>
        policy(requires("analytics:update"))(b)
          .withParams(chartParamsSchema)
          .withOutput(z.void())
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
          }),
    );
}
