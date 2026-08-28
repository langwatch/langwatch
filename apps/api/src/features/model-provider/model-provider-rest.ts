import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import { type OrganizationService, TeamNotFoundError } from "@langwatch/organization-contract";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import {
  type AppRestProjectVariables,
  type AppRestSecurity,
  baseResponses,
  requires,
  type SecuredApp,
  validator as zValidator,
} from "../../app-rest";
import {
  apiResponseModelProvidersSchema,
  updateModelProviderInputSchema,
} from "./model-provider-rest.schemas";

const logger = createLogger("langwatch:api:model-providers");

/** What the organization resolution below writes onto the request context. */
export type ModelProviderRestVariables = AppRestProjectVariables & {
  organization: Readonly<{ id: string }>;
};

/**
 * Resolves the calling project's organization onto the context.
 *
 * Neither handler reads it, and it is kept because dropping it would change
 * what a project whose team has gone missing gets back: today that is a 500
 * saying so, rather than a read that proceeds against a project with no
 * organization behind it.
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

    await next();
  };
}

/**
 * REST for a project's model providers.
 *
 * Both verbs answer with masked credentials, because the same shape is what
 * the settings UI reads: `getForProject` is the masking read, and the write
 * re-reads through it rather than echoing what it was sent.
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
}): SecuredApp<{ Variables: ModelProviderRestVariables }> {
  const { security, modelProviders, organizations } = options;

  const secured = security.createProjectApp<{
    organization: Readonly<{ id: string }>;
  }>({
    basePath: "/api/model-providers",
  });

  // The organization resolution runs AFTER the access chain (which
  // authenticates and sets `project`), so it is applied per route rather than
  // app-wide.
  const organizationMiddleware = resolveOrganization(organizations);

  // List all model providers — read scope, mirrors the tRPC modelProviders
  // getAll (project:view).
  secured.access(requires("project:view")).get(
    "/",
    organizationMiddleware,
    describeRoute({
      description: "List all model providers for a project with masked API keys",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(apiResponseModelProvidersSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const project = c.get("project");

      logger.info({ projectId: project.id }, "Getting all model providers for project");

      const providers = await modelProviders().getForProject({ projectId: project.id });

      return c.json(apiResponseModelProvidersSchema.parse(toLegacyProviders(providers)));
    },
  );

  // Upsert a model provider — write scope, mirrors the tRPC modelProviders
  // update (project:update).
  secured.access(requires("project:update")).put(
    "/:provider",
    organizationMiddleware,
    describeRoute({
      description: "Create or update a model provider",
      responses: {
        ...baseResponses,
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(apiResponseModelProvidersSchema),
            },
          },
        },
        400: {
          description: "Bad request",
          content: {
            "application/json": {
              schema: resolver(z.object({ error: z.string() })),
            },
          },
        },
      },
    }),
    zValidator("json", updateModelProviderInputSchema),
    async (c) => {
      const service = modelProviders();
      const project = c.get("project");
      const { provider } = c.req.param();
      const data = c.req.valid("json");

      logger.info({ projectId: project.id, provider }, "Upserting model provider");

      try {
        // Ensure defaultModel has the provider prefix (e.g. "openai/gpt-4o")
        // required by litellm for routing
        let defaultModel = data.defaultModel;
        if (defaultModel && !defaultModel.includes("/")) {
          defaultModel = `${provider}/${defaultModel}`;
        }

        // REST endpoint is keyed on the provider string in the URL and
        // preserves the legacy single-instance upsert contract. The
        // multi-instance create flow lives behind the tRPC `update`
        // procedure, which goes through the id-based path.
        await service.upsert({
          projectId: project.id,
          provider,
          enabled: data.enabled,
          customKeys: data.customKeys as Record<string, unknown> | undefined,
          customModels: toCanonicalModels(data.customModels, "chat"),
          customEmbeddingsModels: toCanonicalModels(data.customEmbeddingsModels, "embedding"),
          extraHeaders: data.extraHeaders,
          defaultModel,
        });
      } catch (error) {
        if (error instanceof Error) {
          throw new HTTPException(400, { message: error.message });
        }
        throw error;
      }

      // Return updated providers list with masked keys
      const providers = await service.getForProject({ projectId: project.id });

      logger.info({ projectId: project.id, provider }, "Successfully upserted model provider");

      return c.json(apiResponseModelProvidersSchema.parse(toLegacyProviders(providers)));
    },
  );

  return secured;
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

function toCanonicalModels(value: unknown, type: "chat" | "embedding") {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((model) => {
    if (typeof model === "string") return [{ id: model, label: model, type }];
    if (!model || typeof model !== "object") return [];
    const item = model as { modelId?: unknown; displayName?: unknown };
    return typeof item.modelId === "string"
      ? [
          {
            id: item.modelId,
            label: typeof item.displayName === "string" ? item.displayName : item.modelId,
            type,
          },
        ]
      : [];
  });
}
