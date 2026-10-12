/**
 * Dashboard widgets — the REST routes (custom-chart-playground authored).
 *
 * Endpoints under the LangWatchQL analytics SQL family, the twin of the
 * saved-workbench-chart routes for the widget's own `CustomGraph` kind:
 *
 *  - `GET    /api/v1/projects/{projectId}/analytics/dashboard-widgets`
 *  - `POST   /api/v1/projects/{projectId}/analytics/dashboard-widgets`
 *  - `GET    /api/v1/projects/{projectId}/analytics/dashboard-widgets/{widgetId}`
 *  - `PATCH  /api/v1/projects/{projectId}/analytics/dashboard-widgets/{widgetId}`
 *  - `POST   /api/v1/projects/{projectId}/analytics/dashboard-widgets/{widgetId}/dashboard`
 *  - `PUT    /api/v1/projects/{projectId}/analytics/dashboard-widgets/{widgetId}/placement`
 *  - `DELETE /api/v1/projects/{projectId}/analytics/dashboard-widgets/{widgetId}/placement`
 *  - `DELETE /api/v1/projects/{projectId}/analytics/dashboard-widgets/{widgetId}`
 *
 * They exist so Langy — and any CLI caller — can create, update, place and
 * delete dashboard widgets, an action surface the dashboard UI itself has
 * through the `dashboardWidgets` tRPC router but no API key could reach.
 * `/dashboard` auto-places at the next free row keeping the widget's size
 * (the `pin` CLI command); `/placement` accepts an explicit grid position,
 * the twin of the saved-workbench-chart `place`/`unplace` routes.
 *
 * ## What is validated here
 *
 * The request's envelope — a name, and a `{ code, queries }` definition whose
 * `queries` match the versioned {@link dashboardWidgetQuerySchema} — and nothing
 * about what a query's SQL means. A widget's queries are governed at run time
 * by `LW.query` inside the sandbox, not at save, exactly as the tRPC router
 * writes them. The single write path is {@link DashboardWidgetService}.
 *
 * @see ~/server/analytics/dashboard-widgets — the service and its shape
 * @see ~/server/api/routers/dashboardWidgets.ts — the UI's tRPC twin
 */

import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import type { Project } from "~/generated/prisma/client";

import { customChartPlaygroundEnabled } from "~/server/analytics/dashboard-widgets/access";
import {
  type DashboardWidget,
  DashboardWidgetService,
} from "~/server/analytics/dashboard-widgets/dashboardWidget.service";
import { CustomChartPlaygroundNotEnabledError } from "~/server/analytics/dashboard-widgets/errors";
import {
  dashboardWidgetCodeSchema,
  dashboardWidgetNameSchema,
  dashboardWidgetQueriesSchema,
} from "~/server/analytics/dashboardWidgetDefinition";
import { type createProjectApp, requires } from "~/server/api/security";
import { validator as zValidator } from "~/server/api/validation";
import { prisma } from "~/server/db";

import { canonicalBaseResponses } from "../../shared/base-responses";
import { platformUrl } from "../../shared/platform-url";
import { apiErrorSchema } from "../../shared/schemas";
import type { RouteResponse } from "../../shared/types";
import { lwqlProject } from "./routeGuards";

/** Request shape only — a length, not a meaning. Matches the tRPC surface. */
const nameSchema = dashboardWidgetNameSchema;

/**
 * The `{ code, queries }` a create supplies, bounded by the same shared
 * schemas the tRPC surface and the versioned definition use — so an oversized
 * `code` or an over-long `queries` list is refused before persistence rather
 * than after `present()` reads it back (CWE-770).
 */
const definitionShape = {
  code: dashboardWidgetCodeSchema,
  queries: dashboardWidgetQueriesSchema,
};

const createWidgetSchema = z.object({
  name: nameSchema,
  ...definitionShape,
});

const updateWidgetSchema = z
  .object({
    name: nameSchema.optional(),
    code: dashboardWidgetCodeSchema.optional(),
    queries: dashboardWidgetQueriesSchema.optional(),
  })
  // A PATCH naming nothing is a mistake worth reporting, and `code` without
  // `queries` (or the reverse) would write half a definition — the two rewrite
  // the `graph` blob together or not at all.
  .refine(
    (body) =>
      body.name !== undefined ||
      (body.code !== undefined && body.queries !== undefined),
    "Provide a name, a full { code, queries } definition, or both.",
  )
  .refine(
    (body) => (body.code === undefined) === (body.queries === undefined),
    "code and queries must be provided together.",
  )
  // The refinements above enforce it, but a refinement is opaque to the spec
  // generator: stated here so the emitted document carries the same floor.
  .openapi({ minProperties: 1 });

// Response schemas exist for the published OpenAPI document. The service owns
// the types; these describe them to a consumer reading the spec, and stay loose
// exactly where the payload genuinely is the caller's (a query's declared
// parameter values).
const querySchema = z.object({
  name: z.string(),
  sql: z.string(),
  parameters: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(["string", "number", "boolean"]),
        default: z.union([z.string(), z.number(), z.boolean()]).optional(),
      }),
    )
    .optional(),
});

const widgetSchema = z.object({
  id: z.string(),
  name: z.string(),
  definition: z.object({
    version: z.number(),
    code: z.string(),
    queries: z.array(querySchema),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
  platformUrl: z.string(),
  dashboardId: z.string().nullable(),
  gridColumn: z.number().int(),
  gridRow: z.number().int(),
  colSpan: z.number().int(),
  rowSpan: z.number().int(),
});

const widgetListSchema = z.object({ data: z.array(widgetSchema) });

/** The `{ dashboardId }` an assign-to-dashboard request supplies. */
const assignDashboardSchema = z.object({
  dashboardId: z.string().min(1),
});

/**
 * A placement request's envelope: a dashboard id, and an optional grid
 * position. What a valid position *is* — the column and span ceilings, and
 * which dashboard this project may name — is the service's placement schema
 * and its tenancy check, not this route's, exactly like the chart route's
 * own `placeChartSchema`.
 */
const placeWidgetSchema = z.object({
  dashboardId: z.string().min(1),
  gridColumn: z.number().int().optional(),
  gridRow: z.number().int().optional(),
  colSpan: z.number().int().optional(),
  rowSpan: z.number().int().optional(),
});

/** The tags every operation in this file carries in the published document. */
const WIDGET_TAGS = ["Analytics / LangWatchQL"];

/**
 * The not-found answer every resource operation can give — a missing id and
 * another project's widget alike, deliberately indistinguishable.
 */
const widgetNotFoundResponse: Record<404, RouteResponse> = {
  404: {
    description: "No dashboard widget with this id in this project",
    content: { "application/json": { schema: resolver(apiErrorSchema) } },
  },
};

/**
 * The widget as the API publishes it.
 *
 * `platformUrl` names the dashboards page: a widget is edited in place on
 * its dashboard, so that's the home surface to land an integrator on.
 */
function widgetResource({
  widget,
  project,
}: {
  widget: DashboardWidget;
  project: Project;
}): z.infer<typeof widgetSchema> {
  return {
    id: widget.id,
    name: widget.name,
    definition: widget.definition,
    createdAt: widget.createdAt.toISOString(),
    updatedAt: widget.updatedAt.toISOString(),
    platformUrl: platformUrl({
      projectSlug: project.slug,
      path: "/analytics/reports",
    }),
    dashboardId: widget.dashboardId,
    gridColumn: widget.gridColumn,
    gridRow: widget.gridRow,
    colSpan: widget.colSpan,
    rowSpan: widget.rowSpan,
  };
}

function widgetService(): DashboardWidgetService {
  return DashboardWidgetService.create(prisma);
}

/**
 * The project this dashboard-widgets request runs for: `lwqlProject`'s
 * usual pair of checks (credential/path match, then the whole-surface LWQL
 * flag), plus this route family's OWN flag — the page and the CLI must agree
 * on whether the playground exists at all, and the whole point of a REST
 * surface is that it cannot be reached by skipping a browser-only check.
 *
 * @throws {CustomChartPlaygroundNotEnabledError} when
 *   `release_custom_chart_playground` is off for this project.
 */
async function dashboardWidgetsProject({
  project,
  requestedProjectId,
}: {
  project: Project;
  requestedProjectId: string | undefined;
}): Promise<Project> {
  const resolved = await lwqlProject({ project, requestedProjectId });
  const enabled = await customChartPlaygroundEnabled({
    prisma,
    projectId: resolved.id,
  });
  if (!enabled) throw new CustomChartPlaygroundNotEnabledError();
  return resolved;
}

/**
 * The widget id the path matched.
 *
 * @throws {Error} when a widget route matched without one — a routing fault,
 *   not a caller's mistake, so a plain error rather than a "not found" that
 *   would report the bug as a normal outcome.
 */
function widgetIdOf(widgetId: string | undefined): string {
  if (!widgetId) {
    throw new Error(
      "dashboard widget route matched without a widgetId path parameter",
    );
  }
  return widgetId;
}

function registerList(secured: ReturnType<typeof createProjectApp>): void {
  secured.access(requires("analytics:view")).get(
    "/:projectId/analytics/dashboard-widgets",
    describeRoute({
      summary: "List dashboard widgets",
      description:
        "Lists every dashboard widget in this project, each with the React source file it renders and the named LangWatchQL queries it may run. Saved workbench charts and builder charts are different kinds and are not listed here.",
      tags: WIDGET_TAGS,
      responses: {
        ...canonicalBaseResponses,
        200: {
          description: "The project's dashboard widgets",
          content: {
            "application/json": { schema: resolver(widgetListSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = await dashboardWidgetsProject({
        project: c.get("project"),
        requestedProjectId: c.req.param("projectId"),
      });
      const widgets = await widgetService().getAll({ projectId: project.id });
      return c.json({
        data: widgets.map((widget) => widgetResource({ widget, project })),
      });
    },
  );
}

function registerCreate(secured: ReturnType<typeof createProjectApp>): void {
  secured.access(requires("analytics:create")).post(
    "/:projectId/analytics/dashboard-widgets",
    describeRoute({
      summary: "Create a dashboard widget",
      description:
        "Saves a React source file and the named LangWatchQL queries it runs as one dashboard widget. The queries' shape is validated against the widget schema; their SQL is governed at run time by LW.query inside the sandbox, not at save.",
      tags: WIDGET_TAGS,
      responses: {
        ...canonicalBaseResponses,
        201: {
          description: "The widget was saved",
          content: { "application/json": { schema: resolver(widgetSchema) } },
        },
      },
    }),
    zValidator("json", createWidgetSchema),
    async (c) => {
      const project = await dashboardWidgetsProject({
        project: c.get("project"),
        requestedProjectId: c.req.param("projectId"),
      });
      const { name, code, queries } = c.req.valid("json");
      const widget = await widgetService().createWidget({
        projectId: project.id,
        input: { name, code, queries },
      });
      return c.json(widgetResource({ widget, project }), 201);
    },
  );
}

function registerRead(secured: ReturnType<typeof createProjectApp>): void {
  secured.access(requires("analytics:view")).get(
    "/:projectId/analytics/dashboard-widgets/:widgetId",
    describeRoute({
      summary: "Get a dashboard widget",
      description:
        "Returns one dashboard widget with its React source and named queries. A widget saved in another project is reported as not found.",
      tags: WIDGET_TAGS,
      responses: {
        ...canonicalBaseResponses,
        ...widgetNotFoundResponse,
        200: {
          description: "The dashboard widget",
          content: { "application/json": { schema: resolver(widgetSchema) } },
        },
      },
    }),
    async (c) => {
      const project = await dashboardWidgetsProject({
        project: c.get("project"),
        requestedProjectId: c.req.param("projectId"),
      });
      const widget = await widgetService().getById({
        id: widgetIdOf(c.req.param("widgetId")),
        projectId: project.id,
      });
      return c.json(widgetResource({ widget, project }));
    },
  );
}

function registerUpdate(secured: ReturnType<typeof createProjectApp>): void {
  secured.access(requires("analytics:update")).patch(
    "/:projectId/analytics/dashboard-widgets/:widgetId",
    describeRoute({
      summary: "Update a dashboard widget",
      description:
        "Replaces a dashboard widget's name, its { code, queries } definition, or both. code and queries are rewritten together — the graph blob holds them as one — so a request that offers one without the other, or neither field at all, is refused.",
      tags: WIDGET_TAGS,
      responses: {
        ...canonicalBaseResponses,
        ...widgetNotFoundResponse,
        200: {
          description: "The updated widget",
          content: { "application/json": { schema: resolver(widgetSchema) } },
        },
      },
    }),
    zValidator("json", updateWidgetSchema),
    async (c) => {
      const project = await dashboardWidgetsProject({
        project: c.get("project"),
        requestedProjectId: c.req.param("projectId"),
      });
      const { name, code, queries } = c.req.valid("json");
      const widget = await widgetService().updateWidget({
        id: widgetIdOf(c.req.param("widgetId")),
        projectId: project.id,
        input: {
          ...(name === undefined ? {} : { name }),
          ...(code === undefined ? {} : { code }),
          ...(queries === undefined ? {} : { queries }),
        },
      });
      return c.json(widgetResource({ widget, project }));
    },
  );
}

function registerAssignDashboard(
  secured: ReturnType<typeof createProjectApp>,
): void {
  secured.access(requires("analytics:update")).post(
    "/:projectId/analytics/dashboard-widgets/:widgetId/dashboard",
    describeRoute({
      summary: "Add a dashboard widget to a dashboard",
      description:
        "Assigns a dashboard widget to a dashboard. The widget is repositioned to the next free row on that dashboard; its size (colSpan/rowSpan) is preserved.",
      tags: WIDGET_TAGS,
      responses: {
        ...canonicalBaseResponses,
        ...widgetNotFoundResponse,
        200: {
          description: "The widget was added to the dashboard",
          content: { "application/json": { schema: resolver(widgetSchema) } },
        },
      },
    }),
    zValidator("json", assignDashboardSchema),
    async (c) => {
      const project = await dashboardWidgetsProject({
        project: c.get("project"),
        requestedProjectId: c.req.param("projectId"),
      });
      const { dashboardId } = c.req.valid("json");
      const widget = await widgetService().assignToDashboard({
        id: widgetIdOf(c.req.param("widgetId")),
        projectId: project.id,
        dashboardId,
      });
      return c.json(widgetResource({ widget, project }));
    },
  );
}

function registerPlace(secured: ReturnType<typeof createProjectApp>): void {
  secured.access(requires("analytics:update")).put(
    "/:projectId/analytics/dashboard-widgets/:widgetId/placement",
    describeRoute({
      summary: "Place a dashboard widget on a dashboard",
      description:
        "Places one dashboard widget on a dashboard in the same project, at the grid position supplied — or, when no grid row is given, at the next row free on that dashboard, counting cards of every kind. A dashboard that is not in this project is reported as not found, exactly like a widget that is not, and nothing is written.",
      tags: WIDGET_TAGS,
      responses: {
        ...canonicalBaseResponses,
        ...widgetNotFoundResponse,
        200: {
          description: "The widget, now placed",
          content: { "application/json": { schema: resolver(widgetSchema) } },
        },
      },
    }),
    zValidator("json", placeWidgetSchema),
    async (c) => {
      const project = await dashboardWidgetsProject({
        project: c.get("project"),
        requestedProjectId: c.req.param("projectId"),
      });
      const widget = await widgetService().placeWidget({
        id: widgetIdOf(c.req.param("widgetId")),
        projectId: project.id,
        input: c.req.valid("json"),
      });
      return c.json(widgetResource({ widget, project }));
    },
  );
}

function registerUnplace(secured: ReturnType<typeof createProjectApp>): void {
  secured.access(requires("analytics:update")).delete(
    "/:projectId/analytics/dashboard-widgets/:widgetId/placement",
    describeRoute({
      summary: "Remove a dashboard widget from its dashboard",
      description:
        "Removes one dashboard widget from whatever dashboard it is on, clearing its grid position along with the dashboard id. Idempotent: unplacing a widget that is not placed answers 204 all the same.",
      tags: WIDGET_TAGS,
      responses: {
        ...canonicalBaseResponses,
        ...widgetNotFoundResponse,
        204: { description: "The widget is no longer on a dashboard" },
      },
    }),
    async (c) => {
      const project = await dashboardWidgetsProject({
        project: c.get("project"),
        requestedProjectId: c.req.param("projectId"),
      });
      await widgetService().unplaceWidget({
        id: widgetIdOf(c.req.param("widgetId")),
        projectId: project.id,
      });
      return c.body(null, 204);
    },
  );
}

function registerDelete(secured: ReturnType<typeof createProjectApp>): void {
  secured.access(requires("analytics:delete")).delete(
    "/:projectId/analytics/dashboard-widgets/:widgetId",
    describeRoute({
      summary: "Delete a dashboard widget",
      description:
        "Deletes one dashboard widget. Answers 204 with no body; deleting a widget that is not in this project is reported as not found.",
      tags: WIDGET_TAGS,
      responses: {
        ...canonicalBaseResponses,
        ...widgetNotFoundResponse,
        204: { description: "The widget was deleted" },
      },
    }),
    async (c) => {
      const project = await dashboardWidgetsProject({
        project: c.get("project"),
        requestedProjectId: c.req.param("projectId"),
      });
      await widgetService().deleteWidget({
        id: widgetIdOf(c.req.param("widgetId")),
        projectId: project.id,
      });
      return c.body(null, 204);
    },
  );
}

/**
 * Registers the dashboard widget routes on the LangWatchQL
 * analytics SQL app.
 *
 * One function per verb because the house line ceiling is per function and a
 * described route is a dozen lines of prose before it is a handler; the split
 * is mechanical and the registration order is the document's.
 */
export function registerDashboardWidgetRoutes(
  secured: ReturnType<typeof createProjectApp>,
): void {
  registerList(secured);
  registerCreate(secured);
  registerRead(secured);
  registerUpdate(secured);
  registerAssignDashboard(secured);
  registerPlace(secured);
  registerUnplace(secured);
  registerDelete(secured);
}
