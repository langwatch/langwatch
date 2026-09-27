import { useLangyStore } from "@langwatch/langy-browser-kit";
import { allModelOptions } from "@langwatch/model-provider-browser-kit";
import { useEffect, useMemo } from "react";

import { api } from "../../../../behavior/langy-api.ts";
import { resolveComposerModel } from "../../../../model/langy-composer-model.ts";
import { useLangyModelOptions } from "./use-langy-model-options.ts";

/**
 * The same feature key Langy's chat route resolves against. Seeds the composer's picker with
 * whatever is actually resolving today.
 */
export const LANGY_GATE_FEATURE_KEY = "langy.chat";

const MODEL_QUERY_OPTIONS = { staleTime: 300_000, refetchOnWindowFocus: false } as const;

/**
 * The composer's model: what the gate resolves to, what the project may pick from, and what its
 * connected providers can actually serve. Seeds the picker, and snaps away from a model no
 * connected provider serves, so the composer never holds a model its own menu does not offer.
 */
export function useLangyComposerModel({ projectId }: { projectId: string | undefined }) {
  const modelOverride = useLangyStore((s) => s.modelOverride);
  const setModelOverride = useLangyStore((s) => s.setModelOverride);

  const resolvedDefaultQuery = api.modelProvider.getResolvedDefault.useQuery(
    { projectId: projectId ?? "", featureKey: LANGY_GATE_FEATURE_KEY },
    { enabled: !!projectId, ...MODEL_QUERY_OPTIONS },
  );
  const resolvedDefaultModel = resolvedDefaultQuery.data?.model;

  // No model resolves for Langy's gate key => the chat route will 409. Gate on
  // SUCCESS, not on "no longer loading", so the inline setup never flashes.
  const langyNeedsModel = !!projectId && resolvedDefaultQuery.isSuccess && !resolvedDefaultModel;

  // The project's Langy key may narrow the picker to an allowlist; null falls
  // back to every model the project's providers offer.
  const modelsAllowedQuery = api.langy.modelsAllowed.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId, ...MODEL_QUERY_OPTIONS },
  );
  const langyModelsAllowed = modelsAllowedQuery.data?.modelsAllowed ?? null;
  const modelOptions = useMemo(() => langyModelsAllowed ?? allModelOptions, [langyModelsAllowed]);

  // Narrowed to the providers connected at this project, team, or organization
  // (ADR-021), the same ladder the turn's virtual key walks.
  const { selectOptions } = useLangyModelOptions({
    options: modelOptions,
    model: modelOverride,
    featureKey: LANGY_GATE_FEATURE_KEY,
  });
  const reachableModels = useMemo(
    () => selectOptions.map((option) => option.value),
    [selectOptions],
  );

  const langyDefaultModel = reachableModels.includes(resolvedDefaultModel ?? "")
    ? resolvedDefaultModel
    : null;

  const settled = !resolvedDefaultQuery.isLoading && !modelsAllowedQuery.isLoading;

  useEffect(() => {
    const next = resolveComposerModel({
      current: modelOverride,
      resolvedDefault: resolvedDefaultModel,
      reachable: reachableModels,
    });
    if (next) setModelOverride(next);
  }, [resolvedDefaultModel, modelOverride, reachableModels, setModelOverride]);

  return {
    modelOverride,
    modelOptions,
    reachableModels,
    langyDefaultModel,
    langyNeedsModel,
    resolvedDefault: resolvedDefaultQuery.data ?? null,
    refetchResolvedDefault: resolvedDefaultQuery.refetch,
    /** The model a panel-open warm boots the worker on, once both model reads settled. */
    warmModel: settled ? modelOverride || langyDefaultModel || null : null,
  };
}

/**
 * A conversation keeps the model it was last used with: when its history lands, the picker
 * follows its latest turn's model — unless the user already picked one, and never a model the
 * project can no longer serve.
 */
export function useFollowConversationModel({
  activeConversationId,
  conversationLastModel,
  reachableModels,
}: {
  activeConversationId: string | null;
  conversationLastModel: string | null | undefined;
  reachableModels: string[];
}) {
  useEffect(() => {
    if (!activeConversationId || !conversationLastModel) return;
    if (reachableModels.length > 0 && !reachableModels.includes(conversationLastModel)) return;
    useLangyStore.getState().followConversationModel({
      conversationId: activeConversationId,
      model: conversationLastModel,
    });
  }, [activeConversationId, conversationLastModel, reachableModels]);
}
