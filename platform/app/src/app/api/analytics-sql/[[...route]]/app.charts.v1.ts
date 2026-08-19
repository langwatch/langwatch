/**
 * Saved workbench charts — the REST routes.
 *
 * Five endpoints under the LangWatchQL analytics SQL family:
 *
 *  - `GET    /api/v1/projects/{projectId}/analytics/charts`
 *  - `POST   /api/v1/projects/{projectId}/analytics/charts`
 *  - `GET    /api/v1/projects/{projectId}/analytics/charts/{chartId}`
 *  - `PATCH  /api/v1/projects/{projectId}/analytics/charts/{chartId}`
 *  - `DELETE /api/v1/projects/{projectId}/analytics/charts/{chartId}`
 *
 * They sit here rather than under `/api/dashboards` because a saved chart is a
 * LangWatchQL artifact before it is a dashboard one: it is behind the same
 * experimental switch, resolved for the project's organization by the same
 * guard, and its refusals are `HandledError`s the family already serialises
 * with their `meta` intact. Dashboard placement stays a dashboard concern.
 *
 * ## Nothing is validated here
 *
 * The handlers check the request's *envelope* — a name, and a definition that
 * was supplied — and nothing about what a definition means. The versioned
 * definition schema, the LangWatchQL validator and the Vega-Lite policy all
 * live behind `SavedWorkbenchChartService`, which is the single write path.
 * Re-declaring any of them here would fork the contract and hand this surface
 * the power to admit a chart the workbench would refuse, which is the one thing
 * slice 1 exists to prevent.
 *
 * @see ~/server/analytics/saved-workbench-charts — the service and its schema
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/zod";
import { z } from "zod";
import { LWQL_VEGA_LIMITS } from "~/features/analytics-query/visualization/vegaLitePolicy";
import { measureSpecBytes } from "~/features/analytics-query/visualization/vegaLiteStructure";
import type { Project } from "~/generated/prisma/client";

import {
  type SavedWorkbenchChart,
  SavedWorkbenchChartService,
} from "~/server/analytics/saved-workbench-charts/savedWorkbenchChart.service";
import { type createProjectApp, requires } from "~/server/api/security";
import { getProtectionsForProject } from "~/server/api/utils";
import { validator as zValidator } from "~/server/api/validation";
import { prisma } from "~/server/db";

import { canonicalBaseResponses } from "../../shared/base-responses";
import { platformUrl } from "../../shared/platform-url";
import { apiErrorSchema } from "../../shared/schemas";
import type { RouteResponse } from "../../shared/types";
import { lwqlProject } from "./routeGuards";

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
const MAX_CHART_DEFINITION_BYTES = LWQL_VEGA_LIMITS.maxSpecBytes + 65_536;

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
  .openapi({ minProperties: 1 });

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
}: {
  chart: SavedWorkbenchChart;
  project: Project;
}): z.infer<typeof chartSchema> {
  return {
    id: chart.id,
    name: chart.name,
    definition: chart.definition,
    // Serialized here rather than left to `JSON.stringify`, so the response
    // matches the string the schema publishes by construction.
    createdAt: chart.createdAt.toISOString(),
    updatedAt: chart.updatedAt.toISOString(),
    platformUrl: platformUrl({
      projectSlug: project.slug,
      path: "/analytics/query",
    }),
  };
}

function chartService(): SavedWorkbenchChartService {
  return SavedWorkbenchChartService.create(prisma);
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

function registerList(secured: ReturnType<typeof createProjectApp>): void {
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
        project: c.get("project"),
        requestedProjectId: c.req.param("projectId"),
      });
      const charts = await chartService().getAll({ projectId: project.id });
      return c.json({
        data: charts.map((chart) => chartResource({ chart, project })),
      });
    },
  );
}

function registerCreate(secured: ReturnType<typeof createProjectApp>): void {
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
        project: c.get("project"),
        requestedProjectId: c.req.param("projectId"),
      });
      const { name, definition } = c.req.valid("json");
      const chart = await chartService().createChart({
        projectId: project.id,
        protections: await getProtectionsForProject(prisma, {
          projectId: project.id,
        }),
        input: { name, definition },
      });
      return c.json(chartResource({ chart, project }), 201);
    },
  );
}

function registerRead(secured: ReturnType<typeof createProjectApp>): void {
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
        project: c.get("project"),
        requestedProjectId: c.req.param("projectId"),
      });
      const chart = await chartService().getById({
        id: chartIdOf(c.req.param("chartId")),
        projectId: project.id,
      });
      return c.json(chartResource({ chart, project }));
    },
  );
}

function registerUpdate(secured: ReturnType<typeof createProjectApp>): void {
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
        project: c.get("project"),
        requestedProjectId: c.req.param("projectId"),
      });
      const { name, definition } = c.req.valid("json");
      const chart = await chartService().updateChart({
        id: chartIdOf(c.req.param("chartId")),
        projectId: project.id,
        protections: await getProtectionsForProject(prisma, {
          projectId: project.id,
        }),
        input: {
          ...(name === undefined ? {} : { name }),
          ...(definition === undefined ? {} : { definition }),
        },
      });
      return c.json(chartResource({ chart, project }));
    },
  );
}

function registerDelete(secured: ReturnType<typeof createProjectApp>): void {
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
        project: c.get("project"),
        requestedProjectId: c.req.param("projectId"),
      });
      await chartService().deleteChart({
        id: chartIdOf(c.req.param("chartId")),
        projectId: project.id,
      });
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
  secured: ReturnType<typeof createProjectApp>,
): void {
  registerList(secured);
  registerCreate(secured);
  registerRead(secured);
  registerUpdate(secured);
  registerDelete(secured);
}
