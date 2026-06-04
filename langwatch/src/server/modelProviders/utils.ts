import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { env } from "../../env.mjs";
import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "../api/routers/modelProviders.utils";
import { prisma } from "../db";
import { nlpgoProxyBaseURL } from "../nlpgo/nlpgoFetch";
import { featureByKey } from "./featureRegistry";
import { ModelNotConfiguredError } from "./modelNotConfiguredError";
import { ModelProviderDisabledError } from "./modelProviderDisabledError";
import type { MaybeStoredModelProvider } from "./registry";
import {
  findAlternateBelowScope,
  resolveModelForFeature,
} from "./resolveModelForFeature";

/**
 * Returns a Vercel AI SDK model handle for the given project + feature.
 *
 * Resolution: an explicit `model` argument wins. Otherwise the cascade
 * resolver returns whatever model the given feature key resolves to at
 * the project's scope chain; without a feature key we default to
 * `prompt.create_default` since that's the canonical DEFAULT role
 * surface. If nothing resolves, the resolver throws
 * `ModelNotConfiguredError` and the surrounding tRPC interceptor maps
 * it to a sticky toast prompting the user to configure a default.
 */
export const getVercelAIModel = async (
  projectId: string,
  model?: string,
  featureKey: string = "prompt.create_default",
) => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new Error("Project not found");
  }

  const modelProviders = await getProjectModelProviders(projectId);

  const model_ = await resolveModel({
    explicit: model,
    projectId,
    featureKey,
    modelProviders,
  });

  const providerKey = model_.split("/")[0] as keyof typeof modelProviders;
  const modelProvider = modelProviders[providerKey];

  if (!modelProvider) {
    throw new Error(
      `Model provider "${providerKey}" is not configured for this project. Go to Settings → Model Providers to add it.`,
    );
  }
  if (!modelProvider.enabled) {
    throw new Error(
      `Model provider "${providerKey}" is configured but disabled. Go to Settings → Model Providers to enable it.`,
    );
  }

  const litellmParams = await prepareLitellmParams({
    model: model_,
    modelProvider,
    projectId,
  });
  const headers = Object.fromEntries(
    Object.entries(litellmParams).map(([key, value]) => [
      `x-litellm-${key}`,
      value,
    ]),
  );

  // Go playground proxy: nlpgo's /go/proxy/v1/* (in-process AI Gateway,
  // no LiteLLM). Wire shape is x-litellm-* headers + OpenAI body; the Go
  // side reads x-litellm-* via the gatewayproxy package and dispatches
  // in-process.
  const baseURL = nlpgoProxyBaseURL({
    baseURL: env.LANGWATCH_NLP_SERVICE!,
  });
  const vercelProvider = createOpenAICompatible({
    name: `${providerKey}`,
    apiKey: litellmParams.api_key,
    baseURL,
    headers,
  });

  return vercelProvider(model_);
};

async function resolveModel({
  explicit,
  projectId,
  featureKey,
  modelProviders,
}: {
  explicit: string | undefined;
  projectId: string;
  featureKey: string;
  modelProviders: Record<string, MaybeStoredModelProvider>;
}): Promise<string> {
  // 1. Explicit model always wins.
  if (explicit) return explicit;

  // 2. Cascade-resolved default for the given feature key. Throws
  //    ModelNotConfiguredError when nothing is set at any scope —
  //    that error MUST propagate so the tRPC interceptor maps it to
  //    MODEL_NOT_CONFIGURED and the frontend opens the missing-model
  //    popup with the feature+role in context. Swallowing it here
  //    would silently substitute an unrelated model.
  try {
    const resolved = await resolveModelForFeature(featureKey, {
      prisma,
      projectId,
    });
    const providerKey = resolved.model.split("/")[0] ?? "";
    if (modelProviders[providerKey]?.enabled) return resolved.model;
    // Cascade picked a model but the backing provider is disabled.
    // Silently swapping to a random enabled provider is dangerous (the
    // user thinks they're calling the one they configured); throw a
    // typed error so the frontend can offer a one-click swap to the
    // cascade-next candidate (if any) or a deep-link to settings.
    //
    // `resolved.scope` is always non-null on the success path (the
    // resolver returns ModelNotConfiguredError when nothing resolves,
    // not a null-scope Resolution), but the type is loose — narrow
    // here so the typed error stays correct.
    if (resolved.scope === null) {
      throw new Error("resolveModelForFeature returned a null scope");
    }
    const alternate = await findAlternateBelowScope(
      featureKey,
      { prisma, projectId },
      resolved.scope,
    );
    const feature = featureByKey(featureKey);
    const alternateProviderKey = alternate?.model.split("/")[0] ?? null;
    throw new ModelProviderDisabledError(
      featureKey,
      feature?.displayName ?? featureKey,
      resolved.feature.role,
      projectId,
      resolved.scope,
      resolved.model,
      providerKey,
      alternate && alternate.scope !== null && alternate.scope !== "project"
        ? {
            scope: alternate.scope,
            model: alternate.model,
            providerKey: alternateProviderKey ?? "",
            providerEnabled: Boolean(
              alternateProviderKey &&
                modelProviders[alternateProviderKey]?.enabled,
            ),
          }
        : null,
    );
  } catch (err) {
    if (err instanceof ModelNotConfiguredError) throw err;
    if (err instanceof ModelProviderDisabledError) throw err;
    // Otherwise fall through to the "any enabled provider" rescue;
    // resolver-internal errors (DB, race) get the conservative
    // recovery path.
  }

  // 3. Find any enabled provider with a usable custom model.
  for (const [key, provider] of Object.entries(modelProviders)) {
    if (provider.enabled && provider.customModels?.length) {
      return `${key}/${provider.customModels[0]?.modelId ?? ""}`;
    }
  }

  // 4. Nothing available, distinguish "none configured" from "all disabled".
  if (Object.keys(modelProviders).length > 0) {
    throw new Error(
      "All configured model providers are disabled or have no usable models. Go to Settings → Model Providers to enable one or add a model.",
    );
  }

  throw new Error(
    "No model providers configured for this project. Go to Settings → Model Providers to add one.",
  );
}
