/**
 * `/api/model-providers` — a project's model providers, behind its own key.
 * Both routes answer the same masked list, so a write reads back rather than
 * echoing what was sent.
 */
import {
  baseResponses,
  conflictResponses,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import { toCanonicalCustomModelList } from "../rules/custom-model-list.rules.ts";
import {
  apiResponseModelProvidersSchema,
  updateModelProviderInputSchema,
} from "../rules/model-provider-schemas.rules.ts";

const logger = createLogger("langwatch:api:model-providers");

/** The path parameter naming the provider a write is keyed on. */
const providerParamsSchema = z.object({ provider: z.string().min(1) });

/** One provider row, as this family has always published it. */
type PublishedProvider = {
  id: string;
  provider: string;
  enabled: boolean;
  customKeys: Record<string, unknown> | null;
  customModels: Array<{ id: string; label: string; type: string }>;
  customEmbeddingsModels: Array<{ id: string; label: string; type: string }>;
  models?: string[] | null;
  embeddingsModels?: string[] | null;
};

export const modelProviderRest = defineRestRouter(ModelProviderApi)
  .withNamespace("model-providers")
  .withVersion(MANAGEMENT_API_VERSION)

  // Read scope, mirroring the tRPC modelProvider getAllForProject.
  .get("/", "listModelProviders")
  .withPermission("project:view")
  .withOutput(apiResponseModelProvidersSchema)
  .withDocs({
    tags: ["Model Providers"],
    description: "List all model providers for a project with masked API keys",
    responses: baseResponses,
  })
  .handle(async ({ app, scope }) => {
    logger.info({ projectId: scope.id }, "Getting all model providers for project");

    return published(await app.getForProject({ projectId: scope.id }));
  })

  // Write scope, mirroring the tRPC modelProvider update.
  .put("/:provider", "upsertModelProvider")
  .withParams(providerParamsSchema)
  .withInput(updateModelProviderInputSchema)
  .withPermission("project:update")
  .withOutput(apiResponseModelProvidersSchema)
  .withDocs({
    tags: ["Model Providers"],
    description: "Create or update a model provider",
    // 400 comes from `baseResponses` with the framework's envelope.
    responses: { ...baseResponses, ...conflictResponses },
  })
  .handle(async ({ app, input, scope }) => {
    const { provider, ...data } = input;

    logger.info({ projectId: scope.id, provider }, "Upserting model provider");

    // Uncaught on purpose: the application's refusal carries its own status and
    // code, and the framework boundary renders it; catching to rethrow
    // flattened every case to 400.
    await app.upsertUnattributed({
      projectId: scope.id,
      provider,
      enabled: data.enabled,
      customKeys: data.customKeys,
      customModels: toCanonicalCustomModelList(data.customModels, "chat"),
      customEmbeddingsModels: toCanonicalCustomModelList(data.customEmbeddingsModels, "embedding"),
      extraHeaders: data.extraHeaders,
      defaultModel: qualifiedDefaultModel({ provider, model: data.defaultModel }),
    });

    const providers = await app.getForProject({ projectId: scope.id });

    logger.info({ projectId: scope.id, provider }, "Successfully upserted model provider");

    return published(providers);
  })
  .build();

/**
 * litellm routes on `provider/model`, so a bare model id is qualified with the
 * provider the path named before it is stored.
 */
function qualifiedDefaultModel({
  provider,
  model,
}: {
  provider: string;
  model: string | undefined;
}): string | undefined {
  if (!model || model.includes("/")) return model;

  return `${provider}/${model}`;
}

/** The stored rows in the wire shape this family has always answered with. */
function published(providers: Record<string, PublishedProvider>) {
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
