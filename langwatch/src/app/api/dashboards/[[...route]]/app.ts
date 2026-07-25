import { describeRoute } from "hono-openapi";
import { validator as zValidator } from "~/server/api/validation";
import { z } from "zod";
import { patchZodOpenapi } from "../../../../utils/extend-zod-openapi";
import { createProjectApp, requires } from "~/server/api/security";
import { resourceLimitMiddleware } from "../../middleware";
import {
  type DashboardServiceMiddlewareVariables,
  dashboardServiceMiddleware,
} from "../../middleware/dashboard-service";
import { BadRequestError, NotFoundError } from "../../shared/errors";
import { platformUrl } from "../../shared/platform-url";
import { handleDashboardError } from "./error-handler";

patchZodOpenapi();

// -- Validation schemas --

const createDashboardSchema = z.object({
  name: z.string().min(1, "name is required").max(255),
});

const renameDashboardSchema = z.object({
  name: z.string().min(1, "name is required").max(255),
});

const reorderDashboardsSchema = z.object({
  dashboardIds: z
    .array(z.string().min(1))
    .min(1, "dashboardIds must not be empty"),
});

function mapDashboardNotFoundError(error: unknown): never {
  if (error instanceof Error && error.name === "DashboardNotFoundError") {
    throw new NotFoundError("Dashboard not found");
  }
  throw error;
}

function mapDashboardReorderError(error: unknown): never {
  if (error instanceof Error && error.name === "DashboardReorderError") {
    throw new BadRequestError(error.message);
  }
  throw error;
}

const secured = createProjectApp<DashboardServiceMiddlewareVariables>({
  basePath: "/api/dashboards",
});

secured.hono.onError(handleDashboardError);

// ── List Dashboards ───────────────────────────────────────────
secured.access(requires("analytics:view")).get(
  "/",
  dashboardServiceMiddleware,
  describeRoute({
    description: "List all dashboards for the project with graph counts",
  }),
  async (c) => {
      const project = c.get("project");
      const service = c.get("dashboardService");

      const dashboards = await service.getAll(project.id);

      return c.json({
        data: dashboards.map((d) => ({
          id: d.id,
          name: d.name,
          order: d.order,
          graphCount: d._count.graphs,
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
  dashboardServiceMiddleware,
  describeRoute({
    description: "Create a new dashboard",
  }),
  resourceLimitMiddleware("dashboards"),
  zValidator("json", createDashboardSchema),
  async (c) => {
      const project = c.get("project");
      const { name } = c.req.valid("json");
      const service = c.get("dashboardService");

      const dashboard = await service.create(project.id, name);

      return c.json(
        {
          id: dashboard.id,
          name: dashboard.name,
          order: dashboard.order,
          createdAt: dashboard.createdAt,
          updatedAt: dashboard.updatedAt,
          platformUrl: platformUrl({
            projectSlug: project.slug,
            path: `/analytics/reports?dashboard=${dashboard.id}`,
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
  dashboardServiceMiddleware,
  describeRoute({
    description: "Reorder dashboards by providing an ordered list of IDs",
  }),
  zValidator("json", reorderDashboardsSchema),
  async (c) => {
      const project = c.get("project");
      const { dashboardIds } = c.req.valid("json");
      const service = c.get("dashboardService");

      try {
        const result = await service.reorder(project.id, dashboardIds);
        return c.json(result);
      } catch (error) {
        mapDashboardReorderError(error);
      }
    },
);

// ── Get Single Dashboard ──────────────────────────────────────
secured.access(requires("analytics:view")).get(
  "/:id",
  dashboardServiceMiddleware,
  describeRoute({
    description: "Get a dashboard by its id, including its graphs",
  }),
  async (c) => {
      const { id } = c.req.param();
      const project = c.get("project");
      const service = c.get("dashboardService");

      try {
        const dashboard = await service.getById(project.id, id);
        return c.json({
          id: dashboard.id,
          name: dashboard.name,
          order: dashboard.order,
          graphs: dashboard.graphs,
          createdAt: dashboard.createdAt,
          updatedAt: dashboard.updatedAt,
          platformUrl: platformUrl({
            projectSlug: project.slug,
            path: `/analytics/reports?dashboard=${dashboard.id}`,
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
  dashboardServiceMiddleware,
  describeRoute({
    description: "Rename a dashboard",
  }),
  zValidator("json", renameDashboardSchema),
  async (c) => {
      const { id } = c.req.param();
      const project = c.get("project");
      const { name } = c.req.valid("json");
      const service = c.get("dashboardService");

      try {
        const dashboard = await service.rename(project.id, id, name);
        return c.json({
          id: dashboard.id,
          name: dashboard.name,
          order: dashboard.order,
          createdAt: dashboard.createdAt,
          updatedAt: dashboard.updatedAt,
          platformUrl: platformUrl({
            projectSlug: project.slug,
            path: `/analytics/reports?dashboard=${dashboard.id}`,
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
  dashboardServiceMiddleware,
  describeRoute({
    description: "Delete a dashboard and its graphs (hard delete, cascade)",
  }),
  async (c) => {
      const { id } = c.req.param();
      const project = c.get("project");
      const service = c.get("dashboardService");

      try {
        const dashboard = await service.delete(project.id, id);
        return c.json({
          id: dashboard.id,
          name: dashboard.name,
        });
      } catch (error) {
        return mapDashboardNotFoundError(error);
      }
    },
);

export const app = secured.hono;
