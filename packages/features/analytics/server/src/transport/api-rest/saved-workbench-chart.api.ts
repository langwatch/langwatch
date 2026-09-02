/**
 * Saved workbench charts — the REST routes.
 *
 * Seven endpoints under the LangWatchQL analytics SQL family:
 *
 *  - `GET    /api/v1/projects/{projectId}/analytics/charts`
 *  - `POST   /api/v1/projects/{projectId}/analytics/charts`
 *  - `GET    /api/v1/projects/{projectId}/analytics/charts/{chartId}`
 *  - `PATCH  /api/v1/projects/{projectId}/analytics/charts/{chartId}`
 *  - `DELETE /api/v1/projects/{projectId}/analytics/charts/{chartId}`
 *  - `PUT    /api/v1/projects/{projectId}/analytics/charts/{chartId}/placement`
 *  - `DELETE /api/v1/projects/{projectId}/analytics/charts/{chartId}/placement`
 *
 * They sit here rather than under `/api/dashboards` because a saved chart is a
 * LangWatchQL artifact before it is a dashboard one: it is behind the same
 * experimental switch, resolved for the project's organization by the same
 * guard, and its refusals are `HandledError`s the family already serialises
 * with their `meta` intact. Placement, too, is an operation on the chart — the
 * dashboard is the value it is given, not the resource being edited.
 *
 * ## Nothing is validated here
 *
 * The handlers check the request's *envelope* — a name, and a definition that
 * was supplied — and nothing about what a definition means. The versioned
 * definition schema, the LangWatchQL validator and the Vega-Lite policy all
 * live behind the composed Dashboard service, which is the single write path.
 * Re-declaring any of them here would fork the contract and hand this surface
 * the power to admit a chart the workbench would refuse, which is the one thing
 * slice 1 exists to prevent.
 *
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { requires } from "@langwatch/api";
import {
  apiErrorSchema,
  type AppRestProjectVariables,
  canonicalBaseResponses,
  type RouteResponse,
  type SecuredApp,
  validator as zValidator,
} from "@langwatch/api/rest";
import type { SavedWorkbenchChart } from "@langwatch/dashboard-contract";
import type { ProjectIdentity } from "@langwatch/project-contract";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";

import { type LangWatchQLRestPorts, lwqlProject } from "./langwatch-ql-route-guards";

/** The app every route in this family is registered on. */
type LangWatchQLApp = SecuredApp<{ Variables: AppRestProjectVariables }>;

/**
 * The Vega-Lite specification ceiling this route derives its own from.
 *
 * STATED here rather than imported. The policy that names it — every ceiling,
 * allowlist and rule in the LangWatch QL visualization envelope — lives in
 * `@langwatch/analytics-web`, a browser package, and no server module may
 * value-import one. What crosses is one number, and the number is a wire fact:
 * it is the largest specification the policy admits, so a definition this
 * route accepts is one the policy can still judge.
 *
 * @see packages/features/analytics/web/src/model/visualization/vega-lite-policy.ts
 */
const MAX_VEGA_SPEC_BYTES = 262_144;

/**
 * The serialized size of a definition in UTF-8 bytes, or `null` when it cannot
 * be serialized at all.
 *
 * The same measurement the visualization policy makes of its own ceiling, so
 * this route and that one are in the same unit. `null` is a refusal rather
 * than "small enough": a definition that will not serialize is one nothing
 * downstream can store or draw.
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
 *
 * The definition's *meaning* is the service's to judge, but its size is this
 * route's: nothing below here bounds it — the versioned schema puts no ceiling
 * on the statement it holds — so without this a key-holder could store a body
 * of any size on a surface that is metered everywhere else.
 *
 * Derived from the specification's own ceiling rather than picked, plus room
 * for the statement and parameter values that travel beside it, so this can
 * never refuse a definition the Vega-Lite policy would have admitted. The
 * headroom sits above the query endpoint's statement ceiling too: SQL short
 * enough to run is always short enough to save.
 */
const MAX_CHART_DEFINITION_BYTES = MAX_VEGA_SPEC_BYTES + 65_536;

/**
 * The definition: bounded, and otherwise untouched.
 *
 * `unknown` is the honest declaration of its shape — that belongs to the
 * service's versioned schema, and a definition this route rejected on shape
 * would be rejected by a second, drifting copy of that decision. A byte ceiling
 * forks nothing, because it is a fact about the request rather than about what
 * a chart means.
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
 * A placement request's envelope: a dashboard id, and an optional grid
 * position. What a valid position *is* — the column and span ceilings, and
 * which dashboard this project may name — is the service's placement schema
 * and its tenancy check, not this route's. Re-declaring the bounds here would
 * fork them, and a placement this route admitted that the service refuses is
 * answered with the service's own refusal.
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
 * The not-found answer every resource operation can give — a missing id and
 * another project's chart alike, deliberately indistinguishable.
 *
 * The canonical envelope, like every other refusal this family publishes:
 * {@link canonicalBaseResponses} covers 400/401/403/500, and a 404 is the one
 * status only these operations can answer.
 */
const chartNotFoundResponse: Record<404, RouteResponse> = {
  404: {
    description: "No chart with this id in this project",
    content: { "application/json": { schema: resolver(apiErrorSchema) } },
  },
};

/**
 * The chart as the API publishes it.
 *
 * Built field by field rather than spread: the service's chart also carries
 * `projectId`, which is the credential's and tells a caller nothing it did not
 * already send.
 *
 * `platformUrl` names the workbench rather than this chart, because the
 * workbench has no per-chart URL yet — a link carrying an id nothing reads
 * would land an integrator on an empty editor. It gains one with the dashboard
 * placement slice.
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

/**
 * The chart id the path matched.
 *
 * @throws {Error} when a chart route matched without one. That is a routing
 *   fault rather than a caller's mistake, and the plain error is deliberate:
 *   substituting `""` would turn it into a lookup that answers "not found",
 *   reporting the bug as a normal, expected outcome.
 */
function chartIdOf(chartId: string | undefined): string {
  if (!chartId) {
    throw new Error("chart route matched without a chartId path parameter");
  }
  return chartId;
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

function registerList(secured: LangWatchQLApp, ports: LangWatchQLRestPorts): void {
  secured.access(requires("analytics:view")).get(
    "/:projectId/analytics/charts",
    describeRoute({
      summary: "List saved workbench charts",
      description:
        "Lists every saved LangWatchQL chart in this project, each with the statement it runs, the parameter values it was saved with and the Vega-Lite specification that draws it. Charts built with the chart builder are a different kind and are not listed here.",
      tags: CHART_TAGS,
      responses: {
        ...canonicalBaseResponses,
        200: {
          description: "The project's saved workbench charts",
          content: {
            "application/json": { schema: resolver(chartListSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = await lwqlProject({
        featureFlags: ports.featureFlags(),
        project: c.get("project"),
        projects: ports.projects(),
        requestedProjectId: c.req.param("projectId"),
      });
      const charts = await dashboardSavedChartCall(ports, () =>
        ports.charts().listSavedWorkbenchCharts({ projectId: project.id }),
      );
      return c.json({
        data: charts.map((chart) => chartResource({ chart, project, ports })),
      });
    },
  );
}

function registerCreate(secured: LangWatchQLApp, ports: LangWatchQLRestPorts): void {
  secured.access(requires("analytics:create")).post(
    "/:projectId/analytics/charts",
    describeRoute({
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
    zValidator("json", createChartSchema),
    async (c) => {
      const project = await lwqlProject({
        featureFlags: ports.featureFlags(),
        project: c.get("project"),
        projects: ports.projects(),
        requestedProjectId: c.req.param("projectId"),
      });
      const { name, definition } = c.req.valid("json");
      const protections = await ports.protectionsFor({ projectId: project.id });
      const chart = await dashboardSavedChartCall(ports, () =>
        ports.charts().createSavedWorkbenchChart({
          projectId: project.id,
          protections,
          name,
          definition,
        }),
      );
      return c.json(chartResource({ chart, project, ports }), 201);
    },
  );
}

function registerRead(secured: LangWatchQLApp, ports: LangWatchQLRestPorts): void {
  secured.access(requires("analytics:view")).get(
    "/:projectId/analytics/charts/:chartId",
    describeRoute({
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
    async (c) => {
      const project = await lwqlProject({
        featureFlags: ports.featureFlags(),
        project: c.get("project"),
        projects: ports.projects(),
        requestedProjectId: c.req.param("projectId"),
      });
      const chart = await dashboardSavedChartCall(ports, () =>
        ports.charts().getSavedWorkbenchChart({
          chartId: chartIdOf(c.req.param("chartId")),
          projectId: project.id,
        }),
      );
      return c.json(chartResource({ chart, project, ports }));
    },
  );
}

function registerUpdate(secured: LangWatchQLApp, ports: LangWatchQLRestPorts): void {
  secured.access(requires("analytics:update")).patch(
    "/:projectId/analytics/charts/:chartId",
    describeRoute({
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
    zValidator("json", updateChartSchema),
    async (c) => {
      const project = await lwqlProject({
        featureFlags: ports.featureFlags(),
        project: c.get("project"),
        projects: ports.projects(),
        requestedProjectId: c.req.param("projectId"),
      });
      const { name, definition } = c.req.valid("json");
      const definitionUpdate =
        definition === undefined
          ? undefined
          : {
              definition,
              protections: await ports.protectionsFor({ projectId: project.id }),
            };
      const chart = await dashboardSavedChartCall(ports, () =>
        ports.charts().updateSavedWorkbenchChart({
          chartId: chartIdOf(c.req.param("chartId")),
          projectId: project.id,
          ...(name === undefined ? {} : { name }),
          ...(definitionUpdate === undefined ? {} : { definitionUpdate }),
        }),
      );
      return c.json(chartResource({ chart, project, ports }));
    },
  );
}

function registerDelete(secured: LangWatchQLApp, ports: LangWatchQLRestPorts): void {
  secured.access(requires("analytics:delete")).delete(
    "/:projectId/analytics/charts/:chartId",
    describeRoute({
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
    async (c) => {
      const project = await lwqlProject({
        featureFlags: ports.featureFlags(),
        project: c.get("project"),
        projects: ports.projects(),
        requestedProjectId: c.req.param("projectId"),
      });
      await dashboardSavedChartCall(ports, () =>
        ports.charts().deleteSavedWorkbenchChart({
          chartId: chartIdOf(c.req.param("chartId")),
          projectId: project.id,
        }),
      );
      return c.body(null, 204);
    },
  );
}

function registerPlace(secured: LangWatchQLApp, ports: LangWatchQLRestPorts): void {
  secured.access(requires("analytics:update")).put(
    "/:projectId/analytics/charts/:chartId/placement",
    describeRoute({
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
    zValidator("json", placeChartSchema),
    async (c) => {
      const project = await lwqlProject({
        featureFlags: ports.featureFlags(),
        project: c.get("project"),
        projects: ports.projects(),
        requestedProjectId: c.req.param("projectId"),
      });
      const chart = await dashboardSavedChartCall(ports, () =>
        ports.charts().placeSavedWorkbenchChart({
          projectId: project.id,
          chartId: chartIdOf(c.req.param("chartId")),
          ...c.req.valid("json"),
        }),
      );
      return c.json(chartResource({ chart, project, ports }));
    },
  );
}

function registerUnplace(secured: LangWatchQLApp, ports: LangWatchQLRestPorts): void {
  secured.access(requires("analytics:update")).delete(
    "/:projectId/analytics/charts/:chartId/placement",
    describeRoute({
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
    async (c) => {
      const project = await lwqlProject({
        featureFlags: ports.featureFlags(),
        project: c.get("project"),
        projects: ports.projects(),
        requestedProjectId: c.req.param("projectId"),
      });
      await dashboardSavedChartCall(ports, () =>
        ports.charts().unplaceSavedWorkbenchChart({
          chartId: chartIdOf(c.req.param("chartId")),
          projectId: project.id,
        }),
      );
      return c.body(null, 204);
    },
  );
}

/**
 * Registers the saved workbench chart routes on the LangWatchQL analytics SQL app.
 *
 * One function per verb because the house line ceiling is per function and a
 * described route is a dozen lines of prose before it is a handler; the split
 * is mechanical and the registration order is the document's.
 */
export function registerSavedWorkbenchChartRoutes(
  secured: LangWatchQLApp,
  ports: LangWatchQLRestPorts,
): void {
  registerList(secured, ports);
  registerCreate(secured, ports);
  registerRead(secured, ports);
  registerUpdate(secured, ports);
  registerDelete(secured, ports);
  registerPlace(secured, ports);
  registerUnplace(secured, ports);
}
