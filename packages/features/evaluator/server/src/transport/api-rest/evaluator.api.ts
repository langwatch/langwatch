/**
 * Public Hono REST API for evaluators.
 *
 * Mounted at `/api/evaluators`. Every verb dispatches through the feature's
 * application — the same object the tRPC door reaches — and this file owns the
 * wire contract and nothing else.
 *
 * The application, the platform-URL builder and the organization resolver
 * arrive as arguments, so the family can be mounted into any process that has
 * them and BUILT (for the OpenAPI document and the route-authorization audits)
 * by a process that has none.
 */
import { requires } from "@langwatch/api";
import {
  type AppRestProjectVariables,
  type AppRestSecurity,
  badRequestSchema,
  baseResponses,
  type PlatformUrlBuilder,
  type SecuredApp,
  validator as zValidator,
} from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import type { EvaluatorApp } from "#app/evaluator.app";
import {
  apiResponseEvaluatorSchema,
  createEvaluatorInputSchema,
  updateEvaluatorInputSchema,
} from "./evaluator.schemas";

const apiResponseEvaluatorWithPlatformUrlSchema = apiResponseEvaluatorSchema.extend({
  platformUrl: z.string().url(),
});

const logger = createLogger("langwatch:api:evaluators");

/**
 * The organization the authenticated project belongs to, on the request
 * context. Resolving it reads the application's team graph, so the middleware
 * that sets it is supplied rather than imported.
 */
export type EvaluatorOrganizationVariables = {
  organization: Readonly<{ id: string }>;
};

export type EvaluatorAppVariables = AppRestProjectVariables & EvaluatorOrganizationVariables;

/** The evaluators REST family, built against one process's security. */
export function createEvaluatorsRestApp(options: {
  security: AppRestSecurity;
  /**
   * Resolved per request. Mounting the family must not force the application
   * to be constructed, which is what lets the OpenAPI generator and the
   * route-registry audits build every route without a running process.
   */
  app: () => EvaluatorApp;
  platformUrl: PlatformUrlBuilder;
  /** Sets `organization` on the request context, after authentication. */
  organizationMiddleware: MiddlewareHandler;
}): SecuredApp<{ Variables: EvaluatorAppVariables }> {
  const { security, app, platformUrl, organizationMiddleware } = options;

  const secured = security.createProjectApp<EvaluatorOrganizationVariables>({
    basePath: "/api/evaluators",
  });

  // organizationMiddleware runs after the access chain authenticates and sets
  // `project`, so it is applied per route rather than app-wide.

  // Get all evaluators
  secured.access(requires("evaluations:view")).get(
    "/",
    organizationMiddleware,
    describeRoute({
      description: "Get all evaluators for a project",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.array(apiResponseEvaluatorWithPlatformUrlSchema)),
            },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");

      logger.info({ projectId: project.id }, "Getting all evaluators for project");

      const rows = await app().getAllWithFields({
        projectId: project.id,
      });

      return c.json(
        apiResponseEvaluatorSchema
          .array()
          .parse(rows)
          .map((e) => ({
            ...e,
            platformUrl: platformUrl({
              projectSlug: project.slug,
              path: `/evaluators?drawer.open=evaluatorEditor&drawer.evaluatorId=${e.id}`,
            }),
          })),
      );
    },
  );

  // Get evaluator by ID or slug
  secured.access(requires("evaluations:view")).get(
    "/:idOrSlug{.+}",
    organizationMiddleware,
    describeRoute({
      description: "Get a specific evaluator by ID or slug",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(apiResponseEvaluatorWithPlatformUrlSchema),
            },
          },
        },
        404: {
          description: "Evaluator not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");
      const { idOrSlug } = c.req.param();

      logger.info({ projectId: project.id, idOrSlug }, "Getting evaluator");

      const evaluator = await app().tryGetByIdOrSlugWithFields({
        idOrSlug,
        projectId: project.id,
      });

      if (!evaluator) {
        throw new HTTPException(404, {
          message: "Evaluator not found",
        });
      }

      const parsed = apiResponseEvaluatorSchema.parse(evaluator);
      return c.json({
        ...parsed,
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/evaluators?drawer.open=evaluatorEditor&drawer.evaluatorId=${parsed.id}`,
        }),
      });
    },
  );

  // Create evaluator
  // Creating asks for `evaluations:create`; `:manage` still implies it, so no
  // existing caller changes and a viewer is declined as before.
  secured.access(requires("evaluations:create")).post(
    "/",
    organizationMiddleware,
    describeRoute({
      description: "Create a new evaluator",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(apiResponseEvaluatorWithPlatformUrlSchema),
            },
          },
        },
      },
    }),
    zValidator("json", createEvaluatorInputSchema),
    async (c) => {
      const application = app();
      const project = c.get("project");
      const data = c.req.valid("json");

      logger.info({ projectId: project.id, name: data.name }, "Creating evaluator");

      const evaluator = await application.createWithResolvedDefaults({
        projectId: project.id,
        name: data.name,
        config: data.config,
      });

      const enriched = await application.getByIdWithFields({
        id: evaluator.id,
        projectId: project.id,
      });

      logger.info(
        { projectId: project.id, evaluatorId: enriched.id },
        "Successfully created evaluator",
      );

      const parsedCreated = apiResponseEvaluatorSchema.parse(enriched);
      return c.json({
        ...parsedCreated,
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/evaluators?drawer.open=evaluatorEditor&drawer.evaluatorId=${parsedCreated.id}`,
        }),
      });
    },
  );

  // Update evaluator
  secured.access(requires("evaluations:update")).put(
    "/:id",
    organizationMiddleware,
    describeRoute({
      description: "Update an existing evaluator",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(apiResponseEvaluatorWithPlatformUrlSchema),
            },
          },
        },
        400: {
          description: "Bad request (e.g. attempting to change evaluatorType)",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
        404: {
          description: "Evaluator not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    zValidator("json", updateEvaluatorInputSchema),
    async (c) => {
      const application = app();
      const project = c.get("project");
      const { id } = c.req.param();
      const data = c.req.valid("json");

      logger.info({ projectId: project.id, evaluatorId: id }, "Updating evaluator");

      // Verify evaluator exists
      const existing = await application.tryGetById({
        id,
        projectId: project.id,
      });

      if (!existing) {
        throw new HTTPException(404, {
          message: "Evaluator not found",
        });
      }

      // Enforce evaluatorType immutability
      if (data.config?.evaluatorType !== undefined) {
        const existingConfig = existing.config as {
          evaluatorType?: string;
        } | null;
        const existingType = existingConfig?.evaluatorType;
        if (existingType !== undefined && data.config.evaluatorType !== existingType) {
          throw new HTTPException(400, {
            message: `evaluatorType cannot be changed after creation. Current type: "${existingType}"`,
          });
        }
      }

      // Build update data
      const updateData: Record<string, unknown> = {};
      if (data.name !== undefined) {
        updateData.name = data.name;
      }
      if (data.config !== undefined) {
        // Merge config: keep existing config values, override with provided ones
        const existingConfig = (existing.config as Record<string, unknown>) ?? {};
        updateData.config = {
          ...existingConfig,
          ...data.config,
        };
      }

      const updated = await application.update({
        id,
        projectId: project.id,
        data: updateData,
      });

      const enriched = await application.getByIdWithFields({
        id: updated.id,
        projectId: project.id,
      });

      logger.info(
        { projectId: project.id, evaluatorId: enriched.id },
        "Successfully updated evaluator",
      );

      const parsedUpdated = apiResponseEvaluatorSchema.parse(enriched);
      return c.json({
        ...parsedUpdated,
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/evaluators?drawer.open=evaluatorEditor&drawer.evaluatorId=${parsedUpdated.id}`,
        }),
      });
    },
  );

  // Delete (archive) evaluator
  // Archiving deliberately stays at `:manage`.
  secured.access(requires("evaluations:manage")).delete(
    "/:id",
    organizationMiddleware,
    describeRoute({
      description: "Archive (soft-delete) an evaluator",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.object({ success: z.boolean() })),
            },
          },
        },
        404: {
          description: "Evaluator not found",
          content: {
            "application/json": { schema: resolver(badRequestSchema) },
          },
        },
      },
    }),
    async (c) => {
      const application = app();
      const project = c.get("project");
      const { id } = c.req.param();

      logger.info({ projectId: project.id, evaluatorId: id }, "Archiving evaluator");

      // Verify evaluator exists
      const existing = await application.tryGetById({
        id,
        projectId: project.id,
      });

      if (!existing) {
        throw new HTTPException(404, {
          message: "Evaluator not found",
        });
      }

      await application.archive({
        id,
        projectId: project.id,
      });

      logger.info({ projectId: project.id, evaluatorId: id }, "Successfully archived evaluator");

      return c.json({ success: true });
    },
  );

  return secured;
}
