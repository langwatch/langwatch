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
import {
  type ApiResponseModelProvider,
  apiResponseModelProvidersSchema,
  type CustomModelEntry,
  customModelEntrySchema,
  type Model,
  ModelProviderApi,
  type ModelProviderSummary,
  modelProviderRestParamsSchema,
  updateModelProviderInputSchema,
} from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";

import { toCanonicalCustomModelList } from "../rules/custom-model-list.rules.ts";

const logger = createLogger("langwatch:api:model-providers");

export const modelProviderRest = defineRestRouter(ModelProviderApi)
  .withNamespace("model-providers")
  .withVersion(MANAGEMENT_API_VERSION)

  // Read scope, mirroring the tRPC modelProvider getAllForProject.
  .get("/", "getApiModelProviders")
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
  .put("/:provider", "putApiModelProvidersByProvider")
  .withParams(modelProviderRestParamsSchema)
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
      defaultModel: deriveQualifiedDefaultModel({ provider, model: data.defaultModel }),
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
function deriveQualifiedDefaultModel({
  provider,
  model,
}: {
  provider: string;
  model: string | undefined;
}): string | undefined {
  if (!model || model.includes("/")) return model;

  return `${provider}/${model}`;
}

/** Main's `apiResponseModelProvidersSchema.parse` over the project's provider map. */
function published(
  providers: Record<string, ModelProviderSummary>,
): Record<string, ApiResponseModelProvider> {
  return Object.fromEntries(
    Object.entries(providers).map(([key, provider]) => [key, publishedProvider(provider)]),
  );
}

/**
 * A registry default carries no id or custom models; a stored row's empty custom list reads null.
 */
function publishedProvider(provider: ModelProviderSummary): ApiResponseModelProvider {
  const shared = {
    provider: provider.provider,
    enabled: provider.enabled,
    customKeys: provider.customKeys,
    deploymentMapping: provider.deploymentMapping ?? null,
    models: provider.models ?? null,
    embeddingsModels: provider.embeddingsModels ?? null,
    // Always present: a caller that has to presence-check every field cannot read the entry.
    disabledByDefault: provider.disabledByDefault ?? false,
    extraHeaders: provider.extraHeaders ?? [],
  };
  if (provider.isSystem) return shared;

  return {
    id: provider.id,
    ...shared,
    customModels:
      provider.customModels.length > 0 ? toCustomModelEntries(provider.customModels, "chat") : null,
    customEmbeddingsModels:
      provider.customEmbeddingsModels.length > 0
        ? toCustomModelEntries(provider.customEmbeddingsModels, "embedding")
        : null,
  };
}

function toCustomModelEntries(models: Model[], mode: CustomModelEntry["mode"]): CustomModelEntry[] {
  return models.map((model) =>
    customModelEntrySchema.parse({
      modelId: model.id,
      displayName: model.label,
      mode,
      maxTokens: model.maxTokens,
      supportedParameters: model.supportedParameters,
      multimodalInputs: model.multimodalInputs,
    }),
  );
}
