import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCredentialProbeGate } from "~/hooks/useCredentialProbeGate";
import { useModelProviderApiKeyValidation } from "~/hooks/useModelProviderApiKeyValidation";
import { useModelProviderForm } from "~/hooks/useModelProviderForm";
import { useModelProvidersSettings } from "~/hooks/useModelProvidersSettings";
import type { MaybeStoredModelProvider } from "~/server/modelProviders/registry";
import { api } from "~/utils/api";
import { MASKED_KEY_PLACEHOLDER } from "~/utils/constants";
import {
  type GuidedProvider,
  guidedChatModels,
  registrySpecFor,
} from "./providers";

/**
 * The connect machinery behind the guided provider panel, for the providers
 * that take credentials (Codex has its own hook, the device sign-in).
 *
 * One instance per selected provider. The credentials and the picked model
 * live in the shared provider form, so the save is the same write the
 * settings drawer makes: the row at the organization scope, the Default role
 * pointed at the model. On top of that the guided flow points Langy's own
 * role at the same model and records the connection on the organization,
 * so the panel that opens after landing already has a model to run on.
 */

export type GuidedConnectStatus = "idle" | "checking" | "saving" | "connected";

export interface GuidedConnectedProvider {
  provider: string;
  model: string;
  kind: GuidedProvider["kind"];
}

const EMPTY_PROVIDER = (provider: string): MaybeStoredModelProvider => ({
  provider,
  enabled: false,
  customKeys: null,
  models: null,
  embeddingsModels: null,
  disabledByDefault: true,
  deploymentMapping: null,
  extraHeaders: [],
});

/** What to show when a save or a role write fails without saying why. */
function saveErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Couldn't save this provider";
}

/**
 * The row already stored for this provider, keyed on content rather than on
 * the query result's identity.
 *
 * Every refetch (the key probe invalidates the list, so does a window focus)
 * returns new arrays, and the shared form resets its fields whenever its
 * provider changes, which threw away the key the customer had just typed.
 */
function useStoredProvider({
  providers,
  backendKey,
}: {
  providers: Record<string, unknown> | undefined;
  backendKey: string;
}): { stored: MaybeStoredModelProvider; isUsingEnvVars: boolean } {
  const storedSignature = JSON.stringify(providers?.[backendKey] ?? null);
  const stored: MaybeStoredModelProvider = useMemo(
    () =>
      storedSignature === "null"
        ? EMPTY_PROVIDER(backendKey)
        : (JSON.parse(storedSignature) as MaybeStoredModelProvider),
    [storedSignature, backendKey],
  );
  const isUsingEnvVars =
    stored.enabled &&
    (!stored.customKeys ||
      Object.keys(stored.customKeys as Record<string, unknown>).length === 0);
  return { stored, isUsingEnvVars };
}

/**
 * Which model the person picked, and where they picked it.
 *
 * An api-key provider offers a list to choose from; a manual one is typed in.
 * This is the one place that difference lives, so nothing downstream asks the
 * provider's kind again to find the answer.
 */
function useModelChoice(provider: GuidedProvider): {
  models: string[];
  model: string;
  setModel: (next: string) => void;
  manualModel: string;
  setManualModel: (next: string) => void;
  finalModel: string;
} {
  const models = useMemo(
    () => (provider.kind === "api-key" ? guidedChatModels(provider) : []),
    [provider],
  );
  const [model, setModel] = useState<string>(models[0] ?? "");
  const [manualModel, setManualModel] = useState("");
  const finalModel = (provider.kind === "manual" ? manualModel : model).trim();
  return { models, model, setModel, manualModel, setManualModel, finalModel };
}

/**
 * Whether Connect can be pressed: every required field filled, and a model
 * named. A typed model needs more than one character; a picked one is
 * whatever the list offered.
 */
export function connectReady({
  provider,
  customKeys,
  finalModel,
  status,
}: {
  provider: GuidedProvider;
  customKeys: Record<string, string>;
  finalModel: string;
  status: GuidedConnectStatus;
}): boolean {
  if (status !== "idle") return false;
  const filled = provider.fields.every(
    (field) =>
      field.optional || (customKeys[field.key]?.trim().length ?? 0) > 3,
  );
  const minimum = provider.kind === "api-key" ? 1 : 2;
  return filled && finalModel.length >= minimum;
}

/**
 * Points the shared form at the picked model.
 *
 * The model is chosen before Connect, so the form holds it when the save
 * reads its snapshot. Marking the provider as the default is what makes the
 * save write the picked model as the Default role at the organization, on top
 * of the seed's flagship. The form clears both whenever its stored row
 * changes (the list finishing its first load is one such change), so the pick
 * is applied again on the same row change.
 */
function useApplyPickedModel({
  actions,
  provider,
  fullModel,
  finalModel,
  stored,
}: {
  actions: ReturnType<typeof useModelProviderForm>[1];
  provider: GuidedProvider;
  fullModel: string;
  finalModel: string;
  stored: MaybeStoredModelProvider;
}): void {
  const { setProjectDefaultModel, setCustomModels, setUseAsDefaultProvider } =
    actions;
  useEffect(() => {
    if (!fullModel) return;
    setUseAsDefaultProvider(true);
    setProjectDefaultModel(fullModel);
    if (provider.kind === "manual") {
      setCustomModels([
        { modelId: finalModel, displayName: finalModel, mode: "chat" },
      ]);
    }
  }, [
    fullModel,
    finalModel,
    provider.kind,
    stored,
    setProjectDefaultModel,
    setCustomModels,
    setUseAsDefaultProvider,
  ]);
}

/**
 * Whether the panel should say the server's own key is in use: the form shows
 * the mask instead of a key, and a save without a typed key keeps using the
 * server's, so it does not ask for a key it does not need.
 */
function usesEnvironmentKeyFor({
  isUsingEnvVars,
  provider,
  customKeys,
}: {
  isUsingEnvVars: boolean;
  provider: GuidedProvider;
  customKeys: Record<string, string>;
}): boolean {
  return (
    isUsingEnvVars &&
    provider.fields.some(
      (field) =>
        field.secret && customKeys[field.key] === MASKED_KEY_PLACEHOLDER,
    )
  );
}

/**
 * What the guided flow writes once the shared form's save has landed: Langy's
 * own role pointed at the picked model, and the connection recorded on the
 * organization, so the panel that opens after landing has a model to run on.
 */
async function finishGuidedConnect({
  setRoleAssignment,
  recordProvider,
  organizationId,
  backendKey,
  fullModel,
  finalModel,
}: {
  setRoleAssignment: {
    mutateAsync: (input: {
      scopeType: "ORGANIZATION";
      scopeId: string;
      role: "LANGY";
      model: string;
    }) => Promise<unknown>;
  };
  recordProvider: {
    mutateAsync: (input: {
      organizationId: string;
      provider: string;
      model: string;
    }) => Promise<unknown>;
  };
  organizationId: string;
  backendKey: string;
  fullModel: string;
  finalModel: string;
}): Promise<void> {
  await setRoleAssignment.mutateAsync({
    scopeType: "ORGANIZATION",
    scopeId: organizationId,
    role: "LANGY",
    model: fullModel,
  });
  await recordProvider.mutateAsync({
    organizationId,
    provider: backendKey,
    model: finalModel,
  });
}

/**
 * The finish: the two guided writes, then the panel is told the provider is
 * connected. A failure here leaves the status idle with the reason on the
 * credential field, the same way a refused save does.
 */
async function runFinish({
  setRoleAssignment,
  recordProvider,
  organizationId,
  backendKey,
  fullModel,
  finalModel,
  provider,
  setStatus,
  setSaveError,
  onConnected,
  onFailed,
}: Parameters<typeof finishGuidedConnect>[0] & {
  provider: GuidedProvider;
  setStatus: (status: GuidedConnectStatus) => void;
  setSaveError: (message: string | undefined) => void;
  onConnected: (connected: GuidedConnectedProvider) => void;
  onFailed: (failure: { provider: string; code: string }) => void;
}): Promise<void> {
  try {
    await finishGuidedConnect({
      setRoleAssignment,
      recordProvider,
      organizationId,
      backendKey,
      fullModel,
      finalModel,
    });
  } catch (error) {
    setStatus("idle");
    setSaveError(saveErrorMessage(error));
    onFailed({ provider: backendKey, code: "save_failed" });
    return;
  }
  setStatus("connected");
  onConnected({ provider: backendKey, model: finalModel, kind: provider.kind });
}

/**
 * The shared credential form, wired for the guided flow, with the key probe
 * and the refusal gate that go with it.
 *
 * The form saves the row at the organization scope, the same write the
 * settings drawer makes; `finishRef` is what the guided flow adds on top,
 * called once the save has landed.
 */
function useGuidedCredentialForm({
  stored,
  provider,
  projectId,
  organizationId,
  backendKey,
  isUsingEnvVars,
  finishRef,
  setStatus,
  setSaveError,
  onFailed,
}: {
  stored: MaybeStoredModelProvider;
  provider: GuidedProvider;
  projectId: string;
  organizationId: string;
  backendKey: string;
  isUsingEnvVars: boolean;
  finishRef: MutableRefObject<(() => Promise<void>) | null>;
  setStatus: (status: GuidedConnectStatus) => void;
  setSaveError: (message: string | undefined) => void;
  onFailed: (failure: { provider: string; code: string }) => void;
}) {
  const [state, actions] = useModelProviderForm({
    provider: stored,
    projectId,
    organizationId,
    // The person who just created the organization administers it, so the
    // row saves at the organization and serves every project under it.
    canManageOrganization: true,
    canManageTeam: false,
    enabledProvidersCount: 1,
    isUsingEnvVars,
    onSuccess: () => {
      void finishRef.current?.();
    },
    onError: (error) => {
      setStatus("idle");
      setSaveError(saveErrorMessage(error));
      onFailed({ provider: backendKey, code: "save_failed" });
    },
  });

  const validation = useModelProviderApiKeyValidation(
    backendKey,
    state.customKeys,
    projectId,
    organizationId,
    state.scopes,
  );

  const gate = useCredentialProbeGate({
    customKeys: state.customKeys,
    resetKey: provider.id,
  });

  return { state, actions, ...validation, ...gate };
}

export function useGuidedProviderConnect({
  provider,
  projectId,
  organizationId,
  onConnected,
  onFailed,
}: {
  provider: GuidedProvider;
  projectId: string;
  organizationId: string;
  onConnected: (connected: GuidedConnectedProvider) => void;
  onFailed: (failure: { provider: string; code: string }) => void;
}) {
  const spec = registrySpecFor(provider);
  const backendKey = spec.backendModelProviderKey;
  const choice = useModelChoice(provider);
  const { models, model, manualModel, finalModel } = choice;

  const { providers, isLoading } = useModelProvidersSettings({ projectId });
  const { stored, isUsingEnvVars } = useStoredProvider({
    providers: providers as Record<string, unknown> | undefined,
    backendKey,
  });

  const [status, setStatus] = useState<GuidedConnectStatus>("idle");
  const [saveError, setSaveError] = useState<string | undefined>();

  const setRoleAssignment =
    api.modelProvider.setRoleAssignmentForScope.useMutation();
  const recordProvider = api.onboarding.recordProvider.useMutation();

  const fullModel = finalModel ? `${backendKey}/${finalModel}` : "";
  const finishRef = useRef<(() => Promise<void>) | null>(null);

  const form = useGuidedCredentialForm({
    stored,
    provider,
    projectId,
    organizationId,
    backendKey,
    isUsingEnvVars,
    finishRef,
    setStatus,
    setSaveError,
    onFailed,
  });
  const { state, actions } = form;
  const {
    validate,
    isValidating,
    validationError,
    validationErrorCode,
    clearError,
    probeRequired,
    recordRefusal,
    clearRefusal,
  } = form;

  useApplyPickedModel({ actions, provider, fullModel, finalModel, stored });

  const setField = useCallback(
    (key: string, value: string) => {
      actions.setCustomKey(key, value);
      clearError();
      setSaveError(undefined);
    },
    [actions, clearError],
  );

  const usesEnvironmentKey = usesEnvironmentKeyFor({
    isUsingEnvVars,
    provider,
    customKeys: state.customKeys,
  });

  const ready = connectReady({
    provider,
    customKeys: state.customKeys,
    finalModel,
    status,
  });

  finishRef.current = () =>
    runFinish({
      setRoleAssignment,
      recordProvider,
      organizationId,
      backendKey,
      fullModel,
      finalModel,
      provider,
      setStatus,
      setSaveError,
      onConnected,
      onFailed,
    });

  const connect = useCallback(async () => {
    if (!ready) return;
    setSaveError(undefined);
    clearError();

    if (probeRequired) {
      setStatus("checking");
      const refused = !(await validate());
      if (refused) {
        recordRefusal();
        setStatus("idle");
        onFailed({
          provider: backendKey,
          code: validationErrorCode ?? "credential_refused",
        });
        return;
      }
      clearRefusal();
    }

    // One save: the form's submit already writes the row as enabled, and
    // toggling it on first would fire the success path before the
    // credentials are on the row.
    setStatus("saving");
    try {
      await actions.submit();
    } catch (error) {
      setStatus("idle");
      setSaveError(saveErrorMessage(error));
      onFailed({ provider: backendKey, code: "save_failed" });
    }
  }, [
    ready,
    clearError,
    probeRequired,
    validate,
    recordRefusal,
    clearRefusal,
    actions,
    backendKey,
    onFailed,
    validationErrorCode,
  ]);

  return {
    kind: provider.kind,
    isLoading,
    values: state.customKeys,
    setField,
    models,
    model,
    setModel: choice.setModel,
    manualModel,
    setManualModel: choice.setManualModel,
    status: isValidating && status === "idle" ? "checking" : status,
    ready,
    usesEnvironmentKey,
    /** The refusal (or the save failure), shown on the credential field. */
    error: validationError ?? saveError,
    connect,
  };
}

export type GuidedProviderConnect = ReturnType<typeof useGuidedProviderConnect>;
