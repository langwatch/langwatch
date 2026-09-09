import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import {
  expandLatestAlias,
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
} from "../rules/legacy-model-provider.rules.ts";
import type {
  ModelCostProjectPort,
  ModelProviderCodexHandlePort,
} from "../ports/model-provider.port.ts";

/**
 * Returns a Vercel AI SDK model handle for the given project + feature.
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
   */
  projects: ModelCostProjectPort;
  /**
   * Where the execution proxy answers, fully formed: nlpgo's `/go/proxy/v1`.
   */
  executionProxyBaseUrl: string;
  /**
   * Codex's own road, where the process composed one. Absent means codex
   * models refuse by name — see {@link ModelProviderCodexHandlePort}.
   */
  codexHandles?: ModelProviderCodexHandlePort;
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
  // 1. Explicit model always wins. A latest alias resolves to the concrete
  //    model here so the provider lookup below reads the real prefix.
  if (explicit) {
    return expandLatestAlias(explicit);
  }

  // 2. Cascade-resolved default for the given feature key.
  const resolved = await tryResolveFeatureDefault({
    projectId,
    featureKey,
    modelProviders,
    modelProviderService,
  });
  if (resolved) {
    return resolved;
  }

  // 3. Find any enabled provider with a usable custom model.
  const rescued = anyEnabledCustomModel(modelProviders);
  if (rescued) {
    return rescued;
  }

  // 4. Nothing available, distinguish "none configured" from "all disabled".
  if (Object.keys(modelProviders).length > 0) {
    throw new Error(
      "All configured model providers are disabled or have no usable models. " +
        "Go to Settings → Model Providers to enable one or add a model.",
    );
  }

  throw new Error(
    "No model providers configured for this project. Go to Settings → Model Providers to add one.",
  );
}

/**
 * The cascade's own answer, or null when a resolver-internal failure (DB, race) leaves the
 * conservative "any enabled provider" rescue to answer instead. `ModelNotConfiguredError` MUST
 * propagate so the tRPC interceptor maps it to MODEL_NOT_CONFIGURED and the frontend opens the
 * missing-model popup with the feature+role in context.
 */
async function tryResolveFeatureDefault({
  projectId,
  featureKey,
  modelProviders,
  modelProviderService,
}: {
  projectId: string;
  featureKey: string;
  modelProviders: Record<string, LegacyModelProviderExecution>;
  modelProviderService: ModelProviderService;
}): Promise<string | null> {
  try {
    const resolved = await modelProviderService.resolveModelForFeature({ projectId, featureKey });
    const providerKey = resolved.model.split("/")[0] ?? "";
    if (modelProviders[providerKey]?.enabled) {
      return resolved.model;
    }

    throw await disabledProviderError({
      resolved,
      providerKey,
      projectId,
      featureKey,
      modelProviders,
      modelProviderService,
    });
  } catch (err) {
    if (err instanceof ModelNotConfiguredError || err instanceof ModelProviderDisabledError) {
      throw err;
    }

    return null;
  }
}

/**
 * Cascade picked a model but the backing provider is disabled. Silently swapping to another
 * enabled provider is dangerous — the user thinks they are calling the one they configured —
 * so this is a typed error the frontend can answer with a one-click swap to the cascade-next
 * candidate, or a deep link to settings.
 */
async function disabledProviderError({
  resolved,
  providerKey,
  projectId,
  featureKey,
  modelProviders,
  modelProviderService,
}: {
  resolved: Awaited<ReturnType<ModelProviderService["resolveModelForFeature"]>>;
  providerKey: string;
  projectId: string;
  featureKey: string;
  modelProviders: Record<string, LegacyModelProviderExecution>;
  modelProviderService: ModelProviderService;
}): Promise<ModelProviderDisabledError> {
  // `resolved.scope` is always non-null on the success path, but the type is
  // loose — narrow here so the typed error stays correct.
  if (resolved.scope === null) {
    throw new Error("resolveModelForFeature returned a null scope");
  }

  const alternate = await tryFindAlternate({
    projectId,
    featureKey,
    skipFromScope: resolved.scope,
    modelProviderService,
  });
  const alternateProviderKey = alternate?.model.split("/")[0] ?? null;

  return new ModelProviderDisabledError(
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
}

/** The cascade-next candidate, or null when nothing else resolves. */
async function tryFindAlternate({
  projectId,
  featureKey,
  skipFromScope,
  modelProviderService,
}: {
  projectId: string;
  featureKey: string;
  skipFromScope: NonNullable<
    Awaited<ReturnType<ModelProviderService["resolveModelForFeature"]>>["scope"]
  >;
  modelProviderService: ModelProviderService;
}): Promise<ModelProviderAlternateResolution | null> {
  try {
    return await modelProviderService.findAlternateModel({ projectId, featureKey, skipFromScope });
  } catch (error) {
    if (!(error instanceof ModelNotConfiguredError)) {
      throw error;
    }

    return null;
  }
}

/** The conservative rescue: the first enabled provider carrying a usable custom model. */
function anyEnabledCustomModel(
  modelProviders: Record<string, LegacyModelProviderExecution>,
): string | null {
  for (const [key, provider] of Object.entries(modelProviders)) {
    if (provider.enabled && provider.customModels?.length) {
      return `${key}/${provider.customModels[0]?.modelId ?? ""}`;
    }
  }

  return null;
}

/**
 * The model-resolution cascade with its collaborators bound once.
 */
export class ModelProviderExecutionHandleService {
  static create(options: ModelProviderExecutionHandleOptions): ModelProviderExecutionHandleService {
    return new ModelProviderExecutionHandleService(options);
  }

  private constructor(private readonly options: ModelProviderExecutionHandleOptions) {}

  static async getVercelAIModel(
    input: ModelProviderExecutionHandleInput & ModelProviderExecutionHandleOptions,
  ): Promise<LanguageModel> {
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
        `Model provider "${providerKey}" is not configured for this project. ` +
          "Go to Settings → Model Providers to add it.",
      );
    }

    if (!modelProvider.enabled) {
      throw new Error(
        `Model provider "${providerKey}" is configured but disabled. ` +
          "Go to Settings → Model Providers to enable it.",
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
          "Codex models cannot be executed by this process: it composes no AI gateway " +
            `credential, and "${model_}" has no other road. Configure the gateway, or ` +
            "choose a model from another provider.",
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
  }

  resolve(input: ModelProviderExecutionHandleInput): Promise<LanguageModel> {
    return ModelProviderExecutionHandleService.getVercelAIModel({ ...this.options, ...input });
  }
}
