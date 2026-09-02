import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import {
  isCodexModel,
  ModelNotConfiguredError,
  ModelProviderDisabledError,
  type ModelProviderAlternateResolution,
  type ModelProviderService,
} from "@langwatch/model-provider-contract";
import {
  getProjectModelProviders,
  type LegacyModelProviderExecution,
  prepareLitellmParams,
} from "../adapters/legacy-model-provider.adapter";
import type {
  ModelCostProjectPort,
  ModelProviderCodexHandlePort,
} from "../ports/model-provider.port";

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
export type ModelProviderExecutionHandleInput = {
  projectId: string;
  model?: string;
  featureKey?: string;
};

export type ModelProviderExecutionHandleOptions = {
  /** The composed gateway every provider row and prepared credential is read from. */
  modelProviders: ModelProviderService;
  /**
   * The project read that decides whether the id names anything at all.
   *
   * `ProjectService` satisfies it. Without it an unknown project resolves to
   * an empty provider set and the customer is told they have configured no
   * providers, which is a different — and wrong — thing to be told.
   */
  projects: ModelCostProjectPort;
  /**
   * Where the execution proxy answers, fully formed: nlpgo's `/go/proxy/v1`.
   *
   * The whole URL rather than the engine's address plus a path this package
   * would have to know, because the path is the WORKFLOW feature's and a
   * feature server package may not reach into another's. The composition root
   * holds both and joins them.
   */
  executionProxyBaseUrl: string;
  /**
   * Codex's own road, where the process composed one. Absent means codex
   * models refuse by name — see {@link ModelProviderCodexHandlePort}.
   */
  codexHandles?: ModelProviderCodexHandlePort;
};

export const getVercelAIModel = async (
  input: ModelProviderExecutionHandleInput & ModelProviderExecutionHandleOptions,
): Promise<LanguageModel> => {
  const { projectId, model, featureKey = "prompt.create_default" } = input;
  const project = await input.projects.tryGetWithTeam(projectId);

  if (!project) {
    throw new Error("Project not found");
  }

  const modelProviders = await getProjectModelProviders(input.modelProviders, projectId);

  const model_ = await resolveModel({
    explicit: model,
    projectId,
    featureKey,
    modelProviders,
    modelProviderService: input.modelProviders,
  });

  const providerKey = model_.split("/")[0] ?? "";
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

  // Codex never goes through the nlpgo chat-completions proxy: the codex
  // backend is Responses-only and its OAuth session lives at the AI
  // gateway, so the handle comes from there instead. The branch sits AFTER
  // the existence/enabled guards so an explicit "openai_codex/..." model
  // cannot bypass a disconnected or disabled provider row.
  if (isCodexModel(model_)) {
    if (!input.codexHandles) {
      throw new Error(
        `Codex models cannot be executed by this process: it composes no AI gateway credential, and "${model_}" has no other road. Configure the gateway, or choose a model from another provider.`,
      );
    }
    return input.codexHandles.resolve({
      projectId,
      model: model_,
      featureKey,
    });
  }

  const litellmParams = await prepareLitellmParams(input.modelProviders, null, {
    model: model_,
    modelProvider,
    projectId,
  });
  const headers = Object.fromEntries(
    Object.entries(litellmParams).map(([key, value]) => [`x-litellm-${key}`, value]),
  );

  // Go playground proxy: nlpgo's /go/proxy/v1/* (in-process AI Gateway,
  // no LiteLLM). Wire shape is x-litellm-* headers + OpenAI body; the Go
  // side reads x-litellm-* via the gatewayproxy package and dispatches
  // in-process.
  const baseURL = input.executionProxyBaseUrl;
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
  modelProviderService,
}: {
  explicit: string | undefined;
  projectId: string;
  featureKey: string;
  modelProviders: Record<string, LegacyModelProviderExecution>;
  modelProviderService: ModelProviderService;
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
    const resolved = await modelProviderService.resolveModelForFeature({
      projectId,
      featureKey,
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
    let alternate: ModelProviderAlternateResolution | null = null;
    try {
      alternate = await modelProviderService.findAlternateModel({
        projectId,
        featureKey,
        skipFromScope: resolved.scope,
      });
    } catch (error) {
      if (!(error instanceof ModelNotConfiguredError)) {
        throw error;
      }
    }
    const alternateProviderKey = alternate?.model.split("/")[0] ?? null;
    throw new ModelProviderDisabledError(
      featureKey,
      resolved.feature.displayName,
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
              alternateProviderKey && modelProviders[alternateProviderKey]?.enabled,
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

/**
 * The model-resolution cascade with its collaborators bound once.
 *
 * The function above is the cascade; this is how a process holds it. Every
 * caller in a process resolves through the SAME instance, which is the point:
 * two instances could disagree about where the execution proxy lives, and the
 * one that drifts answers with a handle pointing at nothing.
 */
export class ModelProviderExecutionHandleService {
  static create(
    options: ModelProviderExecutionHandleOptions,
  ): ModelProviderExecutionHandleService {
    return new ModelProviderExecutionHandleService(options);
  }

  private constructor(private readonly options: ModelProviderExecutionHandleOptions) {}

  resolve(input: ModelProviderExecutionHandleInput): Promise<LanguageModel> {
    return getVercelAIModel({ ...this.options, ...input });
  }
}
