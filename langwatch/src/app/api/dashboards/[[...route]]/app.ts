import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { validator as zValidator } from "hono-openapi/zod";
import { z } from "zod";
import { patchZodOpenapi } from "../../../../utils/extend-zod-openapi";
import {
  type AuthMiddlewareVariables,
  authMiddleware,
  resourceLimitMiddleware,
} from "../../middleware";
import {
  type DashboardServiceMiddlewareVariables,
  dashboardServiceMiddleware,
} from "../../middleware/dashboard-service";
import { loggerMiddleware } from "../../middleware/logger";
import { tracerMiddleware } from "../../middleware/tracer";
import { BadRequestError, NotFoundError } from "../../shared/errors";
import { platformUrl } from "../../shared/platform-url";
import { handleDashboardError } from "./error-handler";

patchZodOpenapi();

type Variables = AuthMiddlewareVariables & DashboardServiceMiddlewareVariables;

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

function validationHook(
  result: {
    success: boolean;
    error?: {
      issues: Array<{ message?: string; path?: (string | number)[] }>;
    };
  },
  c: { json: (body: unknown, status: number) => Response },
): Response | undefined {
  if (!result.success) {
    const issue = result.error?.issues?.[0];
    return c.json(
      {
        error: "Unprocessable Entity",
        message: issue?.message ?? "Validation failed",
        path: issue?.path,
      },
      422,
    );
  }
  return undefined;
}

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

export const app = new Hono<{ Variables: Variables }>()
  .basePath("/api/dashboards")
  .use(tracerMiddleware({ name: "dashboards" }))
  .use(loggerMiddleware())
  .use(authMiddleware)
  .use(dashboardServiceMiddleware)
  .onError(handleDashboardError)

  // ── List Dashboards ───────────────────────────────────────────
  .get(
    "/",
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
            path: `/analytics`,
          }),
        })),
      });
    },
  )

  // ── Create Dashboard ──────────────────────────────────────────
  .post(
    "/",
    describeRoute({
      description: "Create a new dashboard",
    }),
    resourceLimitMiddleware("dashboards"),
    zValidator("json", createDashboardSchema, validationHook),
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
            path: `/analytics`,
          }),
        },
        201,
      );
    },
  )

  // ── Reorder Dashboards ────────────────────────────────────────
  // Placed before /:id to avoid route conflict with "reorder" being treated as an id
  .put(
    "/reorder",
    describeRoute({
      description: "Reorder dashboards by providing an ordered list of IDs",
    }),
    zValidator("json", reorderDashboardsSchema, validationHook),
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
  )

  // ── Get Single Dashboard ──────────────────────────────────────
  .get(
    "/:id",
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
            path: `/analytics`,
          }),
        });
      } catch (error) {
        return mapDashboardNotFoundError(error);
      }
    },
  )

  // ── Rename Dashboard ──────────────────────────────────────────
  .patch(
    "/:id",
    describeRoute({
      description: "Rename a dashboard",
    }),
    zValidator("json", renameDashboardSchema, validationHook),
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
            path: `/analytics`,
          }),
        });
      } catch (error) {
        return mapDashboardNotFoundError(error);
      }
    },
  )

  // ── Delete Dashboard ──────────────────────────────────────────
  .delete(
    "/:id",
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
