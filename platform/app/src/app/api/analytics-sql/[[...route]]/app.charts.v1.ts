/**
 * Saved workbench charts — the REST routes.
 *
 * Five endpoints under the governed analytics SQL family:
 *
 *  - `GET    /api/v1/projects/{projectId}/analytics/charts`
 *  - `POST   /api/v1/projects/{projectId}/analytics/charts`
 *  - `GET    /api/v1/projects/{projectId}/analytics/charts/{chartId}`
 *  - `PATCH  /api/v1/projects/{projectId}/analytics/charts/{chartId}`
 *  - `DELETE /api/v1/projects/{projectId}/analytics/charts/{chartId}`
 *
 * They sit here rather than under `/api/dashboards` because a saved chart is a
 * governed SQL artifact before it is a dashboard one: it is behind the same
 * experimental switch, resolved for the project's organization by the same
 * guard, and its refusals are `HandledError`s the family already serialises
 * with their `meta` intact. Dashboard placement stays a dashboard concern.
 *
 * ## Nothing is validated here
 *
 * The handlers check the request's *envelope* — a name, and a definition that
 * was supplied — and nothing about what a definition means. The versioned
 * definition schema, the governed SQL validator and the Vega-Lite policy all
 * live behind `SavedWorkbenchChartService`, which is the single write path.
 * Re-declaring any of them here would fork the contract and hand this surface
 * the power to admit a chart the workbench would refuse, which is the one thing
 * slice 1 exists to prevent.
 *
 * @see ~/server/analytics/saved-workbench-charts — the service and its schema
 * @see specs/analytics/governed-sql-saved-charts.feature
 */

import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/zod";
import { z } from "zod";
import type { Project } from "~/generated/prisma/client";

import {
  type SavedWorkbenchChart,
  SavedWorkbenchChartService,
} from "~/server/analytics/saved-workbench-charts/savedWorkbenchChart.service";
import { type createProjectApp, requires } from "~/server/api/security";
import { getProtectionsForProject } from "~/server/api/utils";
import { validator as zValidator } from "~/server/api/validation";
import { prisma } from "~/server/db";

import { baseResponses } from "../../shared/base-responses";
import { platformUrl } from "../../shared/platform-url";
import { callerProject, requireGovernedSqlEnabled } from "./routeGuards";

/** Request shape only — a length, not a meaning. Matches the tRPC surface. */
const nameSchema = z.string().min(1).max(200);

const createChartSchema = z.object({
  name: nameSchema,
  /**
   * Passed through untouched. `unknown` is the honest declaration: the shape is
   * the service's versioned schema, and a definition this route rejected would
   * be rejected by a second, drifting copy of that decision.
   */
  definition: z.unknown(),
});

const updateChartSchema = z
  .object({
    name: nameSchema.optional(),
    definition: z.unknown().optional(),
  })
  // A PATCH naming neither field is a mistake worth reporting: answering 200
  // with an untouched chart tells an integrator their update was applied.
  .refine(
    (body) => body.name !== undefined || body.definition !== undefined,
    "Provide a name, a definition, or both.",
  );

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
const CHART_TAGS = ["Analytics / Governed SQL"];

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
}) {
  return {
    id: chart.id,
    name: chart.name,
    definition: chart.definition,
    createdAt: chart.createdAt,
    updatedAt: chart.updatedAt,
    platformUrl: platformUrl({
      projectSlug: project.slug,
      path: "/analytics/query",
    }),
  };
}

/** The service, for a request that has already passed both guards. */
function chartService(): SavedWorkbenchChartService {
  return SavedWorkbenchChartService.create(prisma);
}

/**
 * The project a chart request runs for: the credential's, once the path has
 * been checked against it and the surface has been found switched on.
 *
 * Both guards, in this order, on every route — the flag hides the whole
 * surface, so a caller must not be able to learn a chart id exists by being
 * told the project does not.
 */
async function chartRequestProject({
  project,
  requestedProjectId,
}: {
  project: Project;
  requestedProjectId: string | undefined;
}): Promise<Project> {
  const resolved = callerProject({ project, requestedProjectId });
  await requireGovernedSqlEnabled(resolved);
  return resolved;
}

function registerList(secured: ReturnType<typeof createProjectApp>): void {
  secured.access(requires("analytics:view")).get(
    "/:projectId/analytics/charts",
    describeRoute({
      summary: "List saved workbench charts",
      description:
        "Lists every saved governed SQL chart in this project, each with the statement it runs, the parameter values it was saved with and the Vega-Lite specification that draws it. Charts built with the chart builder are a different kind and are not listed here.",
      tags: CHART_TAGS,
      responses: {
        ...baseResponses,
        200: {
          description: "The project's saved workbench charts",
          content: {
            "application/json": { schema: resolver(chartListSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = await chartRequestProject({
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
        "Saves a governed SQL statement, its bound parameter values and an optional Vega-Lite specification as one chart. The statement is validated by the governed analytics SQL validator against this key's own permissions, and the specification by the visualization policy, before anything is written — a chart that could not be run or drawn is refused rather than stored.",
      tags: CHART_TAGS,
      responses: {
        ...baseResponses,
        201: {
          description: "The chart was saved",
          content: { "application/json": { schema: resolver(chartSchema) } },
        },
      },
    }),
    zValidator("json", createChartSchema),
    async (c) => {
      const project = await chartRequestProject({
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
        "Returns one saved governed SQL chart with its statement, parameter values and specification. A chart saved in another project is reported as not found.",
      tags: CHART_TAGS,
      responses: {
        ...baseResponses,
        200: {
          description: "The saved chart",
          content: { "application/json": { schema: resolver(chartSchema) } },
        },
      },
    }),
    async (c) => {
      const project = await chartRequestProject({
        project: c.get("project"),
        requestedProjectId: c.req.param("projectId"),
      });
      const chart = await chartService().getById({
        id: c.req.param("chartId") ?? "",
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
        ...baseResponses,
        200: {
          description: "The updated chart",
          content: { "application/json": { schema: resolver(chartSchema) } },
        },
      },
    }),
    zValidator("json", updateChartSchema),
    async (c) => {
      const project = await chartRequestProject({
        project: c.get("project"),
        requestedProjectId: c.req.param("projectId"),
      });
      const { name, definition } = c.req.valid("json");
      const chart = await chartService().updateChart({
        id: c.req.param("chartId") ?? "",
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
        "Deletes one saved governed SQL chart. Answers 204 with no body; deleting a chart that is not in this project is reported as not found.",
      tags: CHART_TAGS,
      responses: {
        ...baseResponses,
        204: { description: "The chart was deleted" },
      },
    }),
    async (c) => {
      const project = await chartRequestProject({
        project: c.get("project"),
        requestedProjectId: c.req.param("projectId"),
      });
      await chartService().deleteChart({
        id: c.req.param("chartId") ?? "",
        projectId: project.id,
      });
      return c.body(null, 204);
    },
  );
}

/**
 * Registers the saved workbench chart routes on the governed analytics SQL app.
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
