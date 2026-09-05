import {
  type AppRestSecurity,
  BadRequestError,
  createFamilyErrorHandler,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  NotFoundError,
  type PlatformUrlBuilder,
  type ProjectScopedContext,
  projectOf,
} from "@langwatch/api/rest";
import {
  dashboardDeletedResponseSchema,
  dashboardDetailResponseSchema,
  dashboardListResponseSchema,
  dashboardReorderResponseSchema,
  dashboardResponseSchema,
  type DashboardSummary,
} from "@langwatch/dashboard-contract";
import { isZodLikeError, ValidationError } from "@langwatch/handled-error";
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

const dashboardIdParamsSchema = z.object({ id: z.string().min(1) });

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
}): MountableRestApp {
  const { security, dashboard, platformUrl } = options;

  const { service, policy } = security.createProjectVersionedApp({
    name: "dashboards",
    basePath: "/api/dashboards",
    errorEnvelope: "legacy",
    // The framework's validators raise a bare zod error, which carries neither
    // a status nor a fault; promoting it keeps a rejected body a 422 rather
    // than a 500 the family never sent.
    errorHandler: (boundary) =>
      createFamilyErrorHandler({
        loggerName: "langwatch:api:dashboards:errors",
        label: "Dashboard API Error",
        boundary: (error, c) =>
          boundary(isZodLikeError(error) ? ValidationError.fromZodError(error) : error, c),
      }),
  });

  type DashboardContext = ProjectScopedContext<EndpointVariables>;

  const linkTo = (project: { slug: string }, dashboardId: string): string =>
    platformUrl({
      projectSlug: project.slug,
      path: `/analytics/reports?dashboard=${dashboardId}`,
    });

  const listDashboardsHandler = async (c: DashboardContext) => {
    const project = projectOf(c);

    const dashboards = await dashboard().getAll({
      projectId: project.id,
      graphCountScope: "builder",
    });

    return {
      data: dashboards.map((d: DashboardSummary) => ({
        id: d.id,
        name: d.name,
        order: d.order,
        graphCount: d.graphCount,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        platformUrl: linkTo(project, d.id),
      })),
    };
  };

  const createDashboardHandler = async (
    c: DashboardContext,
    input: z.infer<typeof createDashboardSchema>,
  ) => {
    const project = projectOf(c);

    const created = await dashboard().create({ projectId: project.id, name: input.name });

    return {
      id: created.id,
      name: created.name,
      order: created.order,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      platformUrl: linkTo(project, created.id),
    };
  };

  const reorderDashboardsHandler = async (
    c: DashboardContext,
    input: z.infer<typeof reorderDashboardsSchema>,
  ) => {
    const project = projectOf(c);

    try {
      return await dashboard().reorder({
        projectId: project.id,
        dashboardIds: input.dashboardIds,
      });
    } catch (error) {
      return mapDashboardReorderError(error);
    }
  };

  const getDashboardHandler = async (
    c: DashboardContext,
    input: z.infer<typeof dashboardIdParamsSchema>,
  ) => {
    const project = projectOf(c);

    try {
      const found = await dashboard().getById({ projectId: project.id, dashboardId: input.id });
      return {
        id: found.id,
        name: found.name,
        order: found.order,
        graphs: found.graphs,
        createdAt: found.createdAt,
        updatedAt: found.updatedAt,
        platformUrl: linkTo(project, found.id),
      };
    } catch (error) {
      return mapDashboardNotFoundError(error);
    }
  };

  const renameDashboardHandler = async (
    c: DashboardContext,
    input: z.infer<typeof dashboardIdParamsSchema> & z.infer<typeof renameDashboardSchema>,
  ) => {
    const project = projectOf(c);

    try {
      const renamed = await dashboard().rename({
        projectId: project.id,
        dashboardId: input.id,
        name: input.name,
      });
      return {
        id: renamed.id,
        name: renamed.name,
        order: renamed.order,
        createdAt: renamed.createdAt,
        updatedAt: renamed.updatedAt,
        platformUrl: linkTo(project, renamed.id),
      };
    } catch (error) {
      return mapDashboardNotFoundError(error);
    }
  };

  const deleteDashboardHandler = async (
    c: DashboardContext,
    input: z.infer<typeof dashboardIdParamsSchema>,
  ) => {
    const project = projectOf(c);

    try {
      const deleted = await dashboard().delete({ projectId: project.id, dashboardId: input.id });
      return { id: deleted.id, name: deleted.name };
    } catch (error) {
      return mapDashboardNotFoundError(error);
    }
  };

  return (
    service
      .registerRoute("get", "/", MANAGEMENT_API_VERSION, listDashboardsHandler, (b) =>
        policy("analytics:view")(b)
          .withOutput(dashboardListResponseSchema)
          .withDocs({
            operationId: "listDashboards",
            tags: ["Dashboards"],
            description: "List all dashboards for the project with graph counts",
          }),
      )
      // Creating asks for `analytics:create`; `:manage` still implies it, so
      // nobody who could create a dashboard yesterday loses that, and a viewer
      // holding only `analytics:view` is declined exactly as before.
      .registerRoute("post", "/", MANAGEMENT_API_VERSION, createDashboardHandler, (b) =>
        policy("analytics:create")(b)
          .withInput(createDashboardSchema)
          .withOutput(dashboardResponseSchema)
          .withStatus(201)
          .withDocs({
            operationId: "createDashboard",
            tags: ["Dashboards"],
            description: "Create a new dashboard",
          }),
      )
      // Registered before /:id so "reorder" is not read as an id. Reordering
      // rewrites existing dashboards' positions — an `:update`.
      .registerRoute("put", "/reorder", MANAGEMENT_API_VERSION, reorderDashboardsHandler, (b) =>
        policy("analytics:update")(b)
          .withInput(reorderDashboardsSchema)
          .withOutput(dashboardReorderResponseSchema)
          .withDocs({
            operationId: "reorderDashboards",
            tags: ["Dashboards"],
            description: "Reorder dashboards by providing an ordered list of IDs",
          }),
      )
      .registerRoute("get", "/:id", MANAGEMENT_API_VERSION, getDashboardHandler, (b) =>
        policy("analytics:view")(b)
          .withParams(dashboardIdParamsSchema)
          .withOutput(dashboardDetailResponseSchema)
          .withDocs({
            operationId: "getDashboard",
            tags: ["Dashboards"],
            description: "Get a dashboard by its id, including its graphs",
          }),
      )
      .registerRoute("patch", "/:id", MANAGEMENT_API_VERSION, renameDashboardHandler, (b) =>
        policy("analytics:update")(b)
          .withParams(dashboardIdParamsSchema)
          .withInput(renameDashboardSchema)
          .withOutput(dashboardResponseSchema)
          .withDocs({
            operationId: "renameDashboard",
            tags: ["Dashboards"],
            description: "Rename a dashboard",
          }),
      )
      // Hard delete with cascade — deliberately stays at `:manage`.
      .registerRoute("delete", "/:id", MANAGEMENT_API_VERSION, deleteDashboardHandler, (b) =>
        policy("analytics:manage")(b)
          .withParams(dashboardIdParamsSchema)
          .withOutput(dashboardDeletedResponseSchema)
          .withDocs({
            operationId: "deleteDashboard",
            tags: ["Dashboards"],
            description: "Delete a dashboard and its graphs (hard delete, cascade)",
          }),
      )
      .build()
  );
}
