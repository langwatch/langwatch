import { findRecommendedChatModels } from "@langwatch/model-provider-contract";
import { useEffect, useMemo, useRef, useState } from "react";

import { guidedModelCatalogFor } from "../model/guided-credential-fields.ts";
import type {
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "./use-model-provider-form.ts";

/** The chat model a guided panel picked, when it offered one. */
export type GuidedSave = { chatModel?: string };

/** main's pill count on the guided provider card. */
const GUIDED_MODEL_PILLS_MAX = 4;

/**
 * The guided panel's pick and its connected state, both reported through `onSaved`. A typed
 * name (a deployment, or a model with no chips) wins over the chips until a chip is clicked.
 */
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
  const [typed, setTyped] = useState("");
  const [connected, setConnected] = useState(false);
  const catalog = guidedModelCatalogFor({ providerKey });
  const models = useMemo(
    () =>
      guided ? findRecommendedChatModels({ provider: catalog, limit: GUIDED_MODEL_PILLS_MAX }) : [],
    [guided, catalog],
  );
  const chatModel = typed.trim() || picked || models[0];
  // The provider has no catalog entry for the pick, so it is saved as one of its own models.
  const registersModel = catalog !== providerKey || models.length === 0;
  const pick = (model: string) => {
    setPicked(model);
    setTyped("");
  };
  const saved = onSaved
    ? () => {
        setConnected(true);
        onSaved(chatModel ? { chatModel } : {});
      }
    : undefined;

  return {
    models,
    chatModel,
    pick,
    typed,
    type: setTyped,
    registersModel,
    connected,
    onSaved: saved,
  };
}

/**
 * Makes the guided pick, or the typed deployment name, the Default model at the save's scope,
 * and the provider's own model when its catalog has none. The form resets these on a
 * stored-row change, so the pick is applied again then (as main did).
 */
export function useApplyGuidedModel({
  guided,
  providerKey,
  chatModel,
  registersModel,
  state,
  actions,
  storedRow,
}: {
  guided: boolean;
  providerKey: string;
  chatModel: string | undefined;
  registersModel: boolean;
  state: Pick<UseModelProviderFormState, "customModels">;
  actions: Pick<
    UseModelProviderFormActions,
    "setUseAsDefaultProvider" | "setProjectDefaultModel" | "addCustomModel" | "removeCustomModel"
  >;
  storedRow: unknown;
}): void {
  const model = chatModel ?? state.customModels[0]?.modelId;
  const { setUseAsDefaultProvider, setProjectDefaultModel, addCustomModel, removeCustomModel } =
    actions;
  useEffect(() => {
    if (!guided || !model) return;
    setUseAsDefaultProvider(true);
    setProjectDefaultModel(`${providerKey}/${model}`);
  }, [guided, model, providerKey, storedRow, setUseAsDefaultProvider, setProjectDefaultModel]);

  // The stored row's own models stay; only the one this panel added is swapped out.
  const added = useRef<string | undefined>(undefined);
  useEffect(() => {
    added.current = undefined;
  }, [storedRow]);
  const registered = state.customModels.some((entry) => entry.modelId === chatModel);
  useEffect(() => {
    if (!guided || !registersModel || !chatModel) return;
    if (added.current && added.current !== chatModel) {
      removeCustomModel(added.current);
      added.current = undefined;
    }
    if (registered) return;
    addCustomModel({ modelId: chatModel, displayName: chatModel, mode: "chat" });
    added.current = chatModel;
  }, [guided, registersModel, chatModel, registered, storedRow, addCustomModel, removeCustomModel]);
}
