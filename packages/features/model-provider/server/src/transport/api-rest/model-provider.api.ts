import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { toCanonicalCustomModelList } from "../../rules/custom-model-list.rules.ts";
import { createLogger } from "@langwatch/observability";
import { type OrganizationService, TeamNotFoundError } from "@langwatch/organization-contract";
import { isZodLikeError, ValidationError } from "@langwatch/handled-error";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  type AppRestProjectVariables,
  type AppRestSecurity,
  baseResponses,
  conflictResponses,
  type EndpointVariables,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  projectOf,
  type ServiceContext,
} from "@langwatch/api/rest";
import {
  apiResponseModelProvidersSchema,
  updateModelProviderInputSchema,
} from "../../rules/model-provider-schemas.rules.ts";

const logger = createLogger("langwatch:api:model-providers");

/** What the organization resolution below writes onto the request context. */
export type ModelProviderRestVariables = AppRestProjectVariables & {
  organization: Readonly<{ id: string }>;
};

/**
 * Resolves the calling project's organization onto the context.
 */
function resolveOrganization(organizations: () => OrganizationService): MiddlewareHandler {
  return async (c, next) => {
    const project = c.get("project");

    if (!project) {
      return c.json(
        {
          error: "Internal Server Error",
          message: "Trying to use organization middleware without project",
        },
        500,
      );
    }

    try {
      const team = await organizations().getTeamById({ teamId: project.teamId });
      c.set("organization", { id: team.organizationId });
    } catch (error) {
      if (!(error instanceof TeamNotFoundError)) throw error;
      return c.json(
        {
          error: "Internal Server Error",
          message: "Organization not found",
        },
        500,
      );
    }

    return next();
  };
}

/**
 * The framework's validators raise a bare zod error, which carries neither a
 * status nor a fault, so a boundary that only reads handled errors would
 * answer a rejected body 500 instead of the 422 this family sends.
 */
const promotingBoundary =
  (boundary: ErrorHandler): ErrorHandler =>
  (error, c) =>
    boundary(isZodLikeError(error) ? ValidationError.fromZodError(error) : error, c);

/** The path parameter naming the provider a write is keyed on. */
const providerParamsSchema = z.object({ provider: z.string().min(1) });

/**
 * REST for a project's model providers.
 */
export function createModelProvidersRestApp(options: {
  security: AppRestSecurity;
  /**
   * Resolved per request, as reading it off the Hono context used to be:
   * mounting a family must not force its services to be constructed, which is
   * what lets the OpenAPI spec generator build this app with none.
   */
  modelProviders: () => ModelProviderService;
  /** Same, for the organization the resolution above reads. */
  organizations: () => OrganizationService;
}): MountableRestApp {
  const { security, modelProviders, organizations } = options;

  const { service, policy } = security.createProjectVersionedApp({
    name: "model-providers",
    basePath: "/api/model-providers",
    errorEnvelope: "legacy",
    errorHandler: promotingBoundary,
  });

  // The organization resolution runs AFTER the access chain (which
  // authenticates and sets `project`), so it is applied per route rather than
  // app-wide.
  const organizationMiddleware = resolveOrganization(organizations);

  const listProvidersHandler = async (c: ServiceContext<EndpointVariables>) => {
    const project = projectOf(c);

    logger.info({ projectId: project.id }, "Getting all model providers for project");

    const providers = await modelProviders().getForProject({ projectId: project.id });

    return toLegacyProviders(providers);
  };

  const upsertProviderHandler = async (
    c: ServiceContext<EndpointVariables>,
    input: z.infer<typeof providerParamsSchema> & z.infer<typeof updateModelProviderInputSchema>,
  ) => {
    const modelProviderService = modelProviders();
    const project = projectOf(c);
    const { provider, ...data } = input;

    logger.info({ projectId: project.id, provider }, "Upserting model provider");

    // Ensure defaultModel has the provider prefix (e.g. "openai/gpt-4o")
    // required by litellm for routing
    let defaultModel = data.defaultModel;
    if (defaultModel && !defaultModel.includes("/")) {
      defaultModel = `${provider}/${defaultModel}`;
    }

    // Uncaught on purpose: upsert's HandledError carries its own status/code and the
    // framework boundary renders it; catching to rethrow flattened every case to 400.
    await modelProviderService.upsert({
      projectId: project.id,
      provider,
      enabled: data.enabled,
      customKeys: data.customKeys as Record<string, unknown> | undefined,
      customModels: toCanonicalCustomModelList(data.customModels, "chat"),
      customEmbeddingsModels: toCanonicalCustomModelList(data.customEmbeddingsModels, "embedding"),
      extraHeaders: data.extraHeaders,
      defaultModel,
    });

    // Return updated providers list with masked keys
    const providers = await modelProviderService.getForProject({ projectId: project.id });

    logger.info({ projectId: project.id, provider }, "Successfully upserted model provider");

    return toLegacyProviders(providers);
  };

  return service
    .registerRoute("get", "/", MANAGEMENT_API_VERSION, listProvidersHandler, (b) =>
      // Read scope, mirrors the tRPC modelProviders getAll (project:view).
      policy("project:view")(b)
        .withMiddleware(organizationMiddleware)
        .withOutput(apiResponseModelProvidersSchema)
        .withDocs({
          operationId: "listModelProviders",
          tags: ["Model Providers"],
          description: "List all model providers for a project with masked API keys",
          responses: baseResponses,
        }),
    )
    .registerRoute("put", "/:provider", MANAGEMENT_API_VERSION, upsertProviderHandler, (b) =>
      // Write scope, mirrors the tRPC modelProviders update (project:update).
      policy("project:update")(b)
        .withMiddleware(organizationMiddleware)
        .withParams(providerParamsSchema)
        .withInput(updateModelProviderInputSchema)
        .withOutput(apiResponseModelProvidersSchema)
        .withDocs({
          operationId: "upsertModelProvider",
          tags: ["Model Providers"],
          description: "Create or update a model provider",
          responses: {
            ...baseResponses,
            // 400 comes from `baseResponses` with the framework's envelope.
            ...conflictResponses,
          },
        }),
    )
    .build();
}

function toLegacyProviders(
  providers: Record<
    string,
    {
      id: string;
      provider: string;
      enabled: boolean;
      customKeys: Record<string, unknown> | null;
      customModels: Array<{ id: string; label: string; type: string }>;
      customEmbeddingsModels: Array<{ id: string; label: string; type: string }>;
      models?: string[] | null;
      embeddingsModels?: string[] | null;
    }
  >,
) {
  return Object.fromEntries(
    Object.entries(providers).map(([key, provider]) => [
      key,
      {
        id: provider.id,
        provider: provider.provider,
        enabled: provider.enabled,
        customKeys: provider.customKeys,
        deploymentMapping: null,
        models: provider.models ?? null,
        embeddingsModels: provider.embeddingsModels ?? null,
        customModels: provider.customModels.map((model) => ({
          modelId: model.id,
          displayName: model.label,
          mode: "chat" as const,
        })),
        customEmbeddingsModels: provider.customEmbeddingsModels.map((model) => ({
          modelId: model.id,
          displayName: model.label,
          mode: "embedding" as const,
        })),
      },
    ]),
  );
}
