import { requires } from "@langwatch/api";
import {
  type AppRestProjectVariables,
  type AppRestSecurity,
  BadRequestError,
  createFamilyErrorHandler,
  NotFoundError,
  type PlatformUrlBuilder,
  type SecuredApp,
  validator as zValidator,
} from "@langwatch/api/rest";
import type { DashboardSummary } from "@langwatch/dashboard-contract";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import {
  DashboardNotThereError,
  DashboardReorderUnknownIdsError,
  type DashboardApp,
} from "#app/dashboard.app";

// -- Validation schemas --

const createDashboardSchema = z.object({
  name: z.string().min(1, "name is required").max(255),
});

const renameDashboardSchema = z.object({
  name: z.string().min(1, "name is required").max(255),
});

const reorderDashboardsSchema = z.object({
  dashboardIds: z.array(z.string().min(1)).min(1, "dashboardIds must not be empty"),
});

/**
 * Re-words the application's refusal as this family's own HTTP error.
 *
 * The class comparison is the point: this used to read
 * `error.name === "DashboardNotFoundError"`, a string no compiler checks,
 * which a rename would have turned into a silent 500.
 */
function mapDashboardNotFoundError(error: unknown): never {
  if (error instanceof DashboardNotThereError) {
    throw new NotFoundError("Dashboard not found");
  }
  throw error;
}

/**
 * A reorder naming ids that are not there answers 400 here and 404 on the tRPC
 * surface. That disagreement predates the application and is left exactly as
 * it was: reconciling it changes a published status.
 */
function mapDashboardReorderError(error: unknown): never {
  if (error instanceof DashboardReorderUnknownIdsError) {
    throw new BadRequestError(error.message);
  }
  throw error;
}

/**
 * REST for a project's dashboards.
 *
 * The application arrives as a provider rather than being read off the
 * request, so this family can be mounted into any process that has one — the
 * same shape `/api/graphs`, the custom graphs these dashboards are built from,
 * is mounted with, and the same {@link DashboardApp} object.
 */
export function createDashboardsRestApp(options: {
  security: AppRestSecurity;
  /**
   * Resolved per request, as reading it off the Hono context used to be:
   * mounting a family must not force its services to be constructed, which is
   * what lets the OpenAPI spec generator build this app with none.
   */
  dashboard: () => DashboardApp;
  platformUrl: PlatformUrlBuilder;
}): SecuredApp<{ Variables: AppRestProjectVariables }> {
  const { security, dashboard, platformUrl } = options;

  const secured = security.createProjectApp({
    basePath: "/api/dashboards",
  });

  secured.hono.onError(
    createFamilyErrorHandler({
      loggerName: "langwatch:api:dashboards:errors",
      label: "Dashboard API Error",
      boundary: security.legacyErrorHandler,
    }),
  );

  // ── List Dashboards ───────────────────────────────────────────
  secured.access(requires("analytics:view")).get(
    "/",
    describeRoute({
      description: "List all dashboards for the project with graph counts",
    }),
    async (c) => {
      const project = c.get("project");

      const dashboards = await dashboard().getAll({
        projectId: project.id,
        graphCountScope: "builder",
      });

      return c.json({
        data: dashboards.map((d: DashboardSummary) => ({
          id: d.id,
          name: d.name,
          order: d.order,
          graphCount: d.graphCount,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
          platformUrl: platformUrl({
            projectSlug: project.slug,
            path: `/analytics/reports?dashboard=${d.id}`,
          }),
        })),
      });
    },
  );

  // ── Create Dashboard ──────────────────────────────────────────
  // Creating asks for `analytics:create`; `:manage` still implies it, so nobody
  // who could create a dashboard yesterday loses that, and a viewer holding only
  // `analytics:view` is declined exactly as before.
  secured.access(requires("analytics:create")).post(
    "/",
    describeRoute({
      description: "Create a new dashboard",
    }),
    zValidator("json", createDashboardSchema),
    async (c) => {
      const project = c.get("project");
      const { name } = c.req.valid("json");

      const created = await dashboard().create({ projectId: project.id, name });

      return c.json(
        {
          id: created.id,
          name: created.name,
          order: created.order,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
          platformUrl: platformUrl({
            projectSlug: project.slug,
            path: `/analytics/reports?dashboard=${created.id}`,
          }),
        },
        201,
      );
    },
  );

  // ── Reorder Dashboards ────────────────────────────────────────
  // Placed before /:id to avoid route conflict with "reorder" being treated as an id
  // Reordering rewrites existing dashboards' positions — an `:update`.
  secured.access(requires("analytics:update")).put(
    "/reorder",
    describeRoute({
      description: "Reorder dashboards by providing an ordered list of IDs",
    }),
    zValidator("json", reorderDashboardsSchema),
    async (c) => {
      const project = c.get("project");
      const { dashboardIds } = c.req.valid("json");

      try {
        const result = await dashboard().reorder({ projectId: project.id, dashboardIds });
        return c.json(result);
      } catch (error) {
        mapDashboardReorderError(error);
      }
    },
  );

  // ── Get Single Dashboard ──────────────────────────────────────
  secured.access(requires("analytics:view")).get(
    "/:id",
    describeRoute({
      description: "Get a dashboard by its id, including its graphs",
    }),
    async (c) => {
      const { id } = c.req.param();
      const project = c.get("project");

      try {
        const found = await dashboard().getById({ projectId: project.id, dashboardId: id });
        return c.json({
          id: found.id,
          name: found.name,
          order: found.order,
          graphs: found.graphs,
          createdAt: found.createdAt,
          updatedAt: found.updatedAt,
          platformUrl: platformUrl({
            projectSlug: project.slug,
            path: `/analytics/reports?dashboard=${found.id}`,
          }),
        });
      } catch (error) {
        return mapDashboardNotFoundError(error);
      }
    },
  );

  // ── Rename Dashboard ──────────────────────────────────────────
  secured.access(requires("analytics:update")).patch(
    "/:id",
    describeRoute({
      description: "Rename a dashboard",
    }),
    zValidator("json", renameDashboardSchema),
    async (c) => {
      const { id } = c.req.param();
      const project = c.get("project");
      const { name } = c.req.valid("json");

      try {
        const renamed = await dashboard().rename({
          projectId: project.id,
          dashboardId: id,
          name,
        });
        return c.json({
          id: renamed.id,
          name: renamed.name,
          order: renamed.order,
          createdAt: renamed.createdAt,
          updatedAt: renamed.updatedAt,
          platformUrl: platformUrl({
            projectSlug: project.slug,
            path: `/analytics/reports?dashboard=${renamed.id}`,
          }),
        });
      } catch (error) {
        return mapDashboardNotFoundError(error);
      }
    },
  );

  // ── Delete Dashboard ──────────────────────────────────────────
  // Hard delete with cascade — deliberately stays at `:manage`.
  secured.access(requires("analytics:manage")).delete(
    "/:id",
    describeRoute({
      description: "Delete a dashboard and its graphs (hard delete, cascade)",
    }),
    async (c) => {
      const { id } = c.req.param();
      const project = c.get("project");

      try {
        const deleted = await dashboard().delete({ projectId: project.id, dashboardId: id });
        return c.json({
          id: deleted.id,
          name: deleted.name,
        });
      } catch (error) {
        return mapDashboardNotFoundError(error);
      }
    },
  );

  return secured;
}
