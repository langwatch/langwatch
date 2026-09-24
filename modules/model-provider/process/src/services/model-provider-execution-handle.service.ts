import { HandledError } from "@langwatch/handled-error";
import {
  expandLatestAlias,
  isCodexModel,
  ModelProviderDisabledError,
  type ModelProviderApi,
} from "@langwatch/model-provider-contract";
import type { LanguageModel } from "ai";

import type { ModelCostProject, ModelProviderCodexHandle } from "../app/model-provider.members.ts";
import { handleForParameters } from "../rules/execution-handle.rules.ts";
import {
  getProjectModelProviders,
  type LegacyModelProviderExecution,
  prepareLitellmParams,
} from "../rules/legacy-model-provider.rules.ts";

/**
 * Returns a Vercel AI SDK model handle for the given project + feature.
 */
export type ModelProviderExecutionHandleInput = {
  projectId: string;
  model?: string;
  featureKey?: string;
};

/**
 * The operations the resolution cascade below actually calls. Named once so
 * every helper in this file narrows to the same shape instead of each
 * spelling out its own slice of `ModelProviderApi`.
 */
export type ModelProviderResolutionGateway = Pick<
  ModelProviderApi,
  "resolveModelForFeature" | "findAlternateModel" | "getExecutionProviders" | "prepareExecution"
>;

export type ModelProviderExecutionHandleOptions = {
  /** The composed gateway every provider row and prepared credential is read from. */
  modelProviders: ModelProviderResolutionGateway;
  /**
   * The project read that decides whether the id names anything at all.
   */
  projects: ModelCostProject;
  /**
   * Where the execution proxy answers, fully formed: nlpgo's `/go/proxy/v1`.
   */
  executionProxyBaseUrl: string;
  /**
   * Codex's own road, where the process composed one. Absent means codex
   * models refuse by name — see {@link ModelProviderCodexHandle}.
   */
  codexHandles?: ModelProviderCodexHandle;
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
  modelProviderService: ModelProviderResolutionGateway;
}): Promise<string> {
  // 1. Explicit model always wins. A latest alias resolves to the concrete
  //    model here so the provider lookup below reads the real prefix.
  if (explicit) {
    return expandLatestAlias(explicit);
  }

  // 2. The cascade-resolved default for the feature key. Every resolver failure propagates:
  //    `ModelNotConfiguredError` opens the missing-model popup, anything else is unknown.
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
}

/**
 * Cascade picked a model but the backing provider is disabled. Silently
 * swapping to another is dangerous — the user thinks they're calling the
 * one they configured — so this is typed for a one-click swap or a settings deep link.
 */
async function disabledProviderError({
  resolved,
  providerKey,
  projectId,
  featureKey,
  modelProviders,
  modelProviderService,
}: {
  resolved: Awaited<ReturnType<ModelProviderApi["resolveModelForFeature"]>>;
  providerKey: string;
  projectId: string;
  featureKey: string;
  modelProviders: Record<string, LegacyModelProviderExecution>;
  modelProviderService: ModelProviderResolutionGateway;
}): Promise<ModelProviderDisabledError> {
  // `resolved.scope` is always non-null on the success path, but the type is
  // loose — narrow here so the typed error stays correct.
  if (resolved.scope === null) {
    throw new Error("resolveModelForFeature returned a null scope");
  }

  const alternate = await modelProviderService
    .findAlternateModel({ projectId, featureKey, skipFromScope: resolved.scope })
    .catch((error: unknown) => {
      if (HandledError.isHandled(error) && error.code === "model_not_configured") return undefined;
      throw error;
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
    const project = await input.projects.findWithTeam(projectId);

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

    return handleForParameters({
      providerKey,
      model: model_,
      parameters: litellmParams,
      executionProxyBaseUrl: input.executionProxyBaseUrl,
    });
  }

  resolve(input: ModelProviderExecutionHandleInput): Promise<LanguageModel> {
    return ModelProviderExecutionHandleService.getVercelAIModel({ ...this.options, ...input });
  }
}
