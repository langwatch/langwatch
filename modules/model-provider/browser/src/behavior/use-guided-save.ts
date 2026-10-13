import { findRecommendedChatModels } from "@langwatch/model-provider-contract";
import { useEffect, useMemo, useState } from "react";

import type {
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "./use-model-provider-form.ts";

/** The chat model a guided panel picked, when it offered one. */
export type GuidedSave = { chatModel?: string };

/** main's pill count on the guided provider card. */
const GUIDED_MODEL_PILLS_MAX = 4;

/** The guided panel's pick and its connected state, both reported through `onSaved`. */
export function useGuidedSave({
  guided,
  providerKey,
  onSaved,
}: {
  guided: boolean;
  providerKey: string;
  onSaved: ((saved: GuidedSave) => void) | undefined;
}) {
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const [connected, setConnected] = useState(false);
  const models = useMemo(
    () =>
      guided
        ? findRecommendedChatModels({ provider: providerKey, limit: GUIDED_MODEL_PILLS_MAX })
        : [],
    [guided, providerKey],
  );
  const chatModel = picked ?? models[0];
  const saved = onSaved
    ? () => {
        setConnected(true);
        onSaved(chatModel ? { chatModel } : {});
      }
    : undefined;

  return { models, chatModel, pick: setPicked, connected, onSaved: saved };
}

/**
 * Makes the guided pick, or the typed deployment name, the Default model at the save's scope.
 * The form resets both on a stored-row change, so the pick is applied again then (as main did).
 */
export function useApplyGuidedModel({
  guided,
  providerKey,
  chatModel,
  state,
  actions,
  storedRow,
}: {
  guided: boolean;
  providerKey: string;
  chatModel: string | undefined;
  state: Pick<UseModelProviderFormState, "customModels">;
  actions: Pick<UseModelProviderFormActions, "setUseAsDefaultProvider" | "setProjectDefaultModel">;
  storedRow: unknown;
}): void {
  const model = chatModel ?? state.customModels[0]?.modelId;
  const { setUseAsDefaultProvider, setProjectDefaultModel } = actions;
  useEffect(() => {
    if (!guided || !model) return;
    setUseAsDefaultProvider(true);
    setProjectDefaultModel(`${providerKey}/${model}`);
  }, [guided, model, providerKey, storedRow, setUseAsDefaultProvider, setProjectDefaultModel]);
}
