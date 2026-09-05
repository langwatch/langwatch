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
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  type PlatformUrlBuilder,
  projectOf,
  type ProjectScopedContext,
  resolver,
} from "@langwatch/api/rest";
import { createLogger } from "@langwatch/observability";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import type { EvaluatorApp } from "#app/evaluator.app";
import {
  apiResponseEvaluatorSchema,
  createEvaluatorInputSchema,
  updateEvaluatorInputSchema,
} from "../../rules/evaluator-schemas.rules";

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

const idParamsSchema = z.object({ id: z.string().min(1) });
const idOrSlugParamsSchema = z.object({ idOrSlug: z.string().min(1) });
const archivedSchema = z.object({ success: z.boolean() });

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
}): MountableRestApp {
  const { security, app, platformUrl, organizationMiddleware } = options;

  const { service, policy } = security.createProjectVersionedApp({
    name: "evaluators",
    basePath: "/api/evaluators",
    errorEnvelope: "legacy",
    // Runs after the access chain authenticates and sets `project`, which is
    // what it reads the team graph from.
    routeMiddleware: [organizationMiddleware],
  });

  type EvaluatorContext = ProjectScopedContext<EndpointVariables>;

  /** One evaluator as the wire publishes it, with its editor address. */
  const withPlatformUrl = (evaluator: unknown, projectSlug: string) => {
    const parsed = apiResponseEvaluatorSchema.parse(evaluator);
    return {
      ...parsed,
      platformUrl: platformUrl({
        projectSlug,
        path: `/evaluators?drawer.open=evaluatorEditor&drawer.evaluatorId=${parsed.id}`,
      }),
    };
  };

  const listHandler = async (c: EvaluatorContext) => {
    const project = projectOf(c);
    logger.info({ projectId: project.id }, "Getting all evaluators for project");

    const rows = await app().getAllWithFields({ projectId: project.id });
    return apiResponseEvaluatorSchema
      .array()
      .parse(rows)
      .map((e) => ({
        ...e,
        platformUrl: platformUrl({
          projectSlug: project.slug,
          path: `/evaluators?drawer.open=evaluatorEditor&drawer.evaluatorId=${e.id}`,
        }),
      }));
  };

  const getHandler = async (
    c: EvaluatorContext,
    input: z.infer<typeof idOrSlugParamsSchema>,
  ) => {
    const project = projectOf(c);
    logger.info({ projectId: project.id, idOrSlug: input.idOrSlug }, "Getting evaluator");

    const evaluator = await app().tryGetByIdOrSlugWithFields({
      idOrSlug: input.idOrSlug,
      projectId: project.id,
    });
    if (!evaluator) {
      throw new HTTPException(404, { message: "Evaluator not found" });
    }
    return withPlatformUrl(evaluator, project.slug);
  };

  const createHandler = async (
    c: EvaluatorContext,
    input: z.infer<typeof createEvaluatorInputSchema>,
  ) => {
    const application = app();
    const project = projectOf(c);
    logger.info({ projectId: project.id, name: input.name }, "Creating evaluator");

    const evaluator = await application.createWithResolvedDefaults({
      projectId: project.id,
      name: input.name,
      config: input.config,
    });
    const enriched = await application.getByIdWithFields({
      id: evaluator.id,
      projectId: project.id,
    });
    logger.info(
      { projectId: project.id, evaluatorId: enriched.id },
      "Successfully created evaluator",
    );
    return withPlatformUrl(enriched, project.slug);
  };

  const updateHandler = async (
    c: EvaluatorContext,
    input: z.infer<typeof idParamsSchema> & z.infer<typeof updateEvaluatorInputSchema>,
  ) => {
    const application = app();
    const project = projectOf(c);
    const { id } = input;
    logger.info({ projectId: project.id, evaluatorId: id }, "Updating evaluator");

    const existing = await application.tryGetById({ id, projectId: project.id });
    if (!existing) {
      throw new HTTPException(404, { message: "Evaluator not found" });
    }

    // The evaluator type is fixed at creation: changing it would make every
    // stored result mean something else.
    if (input.config?.evaluatorType !== undefined) {
      const existingConfig = existing.config as { evaluatorType?: string } | null;
      const existingType = existingConfig?.evaluatorType;
      if (existingType !== undefined && input.config.evaluatorType !== existingType) {
        throw new HTTPException(400, {
          message: `evaluatorType cannot be changed after creation. Current type: "${existingType}"`,
        });
      }
    }

    const updateData: Record<string, unknown> = {};
    if (input.name !== undefined) {
      updateData.name = input.name;
    }
    if (input.config !== undefined) {
      // Merge config: keep existing config values, override with provided ones
      const existingConfig = (existing.config as Record<string, unknown>) ?? {};
      updateData.config = { ...existingConfig, ...input.config };
    }

    const updated = await application.update({ id, projectId: project.id, data: updateData });
    const enriched = await application.getByIdWithFields({
      id: updated.id,
      projectId: project.id,
    });
    logger.info(
      { projectId: project.id, evaluatorId: enriched.id },
      "Successfully updated evaluator",
    );
    return withPlatformUrl(enriched, project.slug);
  };

  const archiveHandler = async (c: EvaluatorContext, input: z.infer<typeof idParamsSchema>) => {
    const application = app();
    const project = projectOf(c);
    const { id } = input;
    logger.info({ projectId: project.id, evaluatorId: id }, "Archiving evaluator");

    const existing = await application.tryGetById({ id, projectId: project.id });
    if (!existing) {
      throw new HTTPException(404, { message: "Evaluator not found" });
    }

    await application.archive({ id, projectId: project.id });
    logger.info({ projectId: project.id, evaluatorId: id }, "Successfully archived evaluator");
    return { success: true };
  };

  const notFoundResponse = {
    404: {
      description: "Evaluator not found",
      content: { "application/json": { schema: resolver(badRequestSchema) } },
    },
  };

  return (
    service
      .registerRoute("get", "/", MANAGEMENT_API_VERSION, listHandler, (b) =>
        policy(requires("evaluations:view"))(b)
          .withOutput(z.array(apiResponseEvaluatorWithPlatformUrlSchema))
          .withDocs({
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
      )
      .registerRoute("get", "/:idOrSlug{.+}", MANAGEMENT_API_VERSION, getHandler, (b) =>
        policy(requires("evaluations:view"))(b)
          .withParams(idOrSlugParamsSchema)
          .withOutput(apiResponseEvaluatorWithPlatformUrlSchema)
          .withDocs({
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
              ...notFoundResponse,
            },
          }),
      )
      // Creating asks for `evaluations:create`; `:manage` still implies it, so
      // no existing caller changes and a viewer is declined as before.
      .registerRoute("post", "/", MANAGEMENT_API_VERSION, createHandler, (b) =>
        policy(requires("evaluations:create"))(b)
          .withInput(createEvaluatorInputSchema)
          .withOutput(apiResponseEvaluatorWithPlatformUrlSchema)
          .withDocs({
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
      )
      .registerRoute("put", "/:id", MANAGEMENT_API_VERSION, updateHandler, (b) =>
        policy(requires("evaluations:update"))(b)
          .withParams(idParamsSchema)
          .withInput(updateEvaluatorInputSchema)
          .withOutput(apiResponseEvaluatorWithPlatformUrlSchema)
          .withDocs({
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
                content: { "application/json": { schema: resolver(badRequestSchema) } },
              },
              ...notFoundResponse,
            },
          }),
      )
      // Archiving deliberately stays at `:manage`.
      .registerRoute("delete", "/:id", MANAGEMENT_API_VERSION, archiveHandler, (b) =>
        policy(requires("evaluations:manage"))(b)
          .withParams(idParamsSchema)
          .withOutput(archivedSchema)
          .withDocs({
            description: "Archive (soft-delete) an evaluator",
            responses: {
              ...baseResponses,
              200: {
                description: "Success",
                content: { "application/json": { schema: resolver(archivedSchema) } },
              },
              ...notFoundResponse,
            },
          }),
      )
      .build()
  );
}
