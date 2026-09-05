import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const models = useMemo(
    () => (provider.kind === "api-key" ? guidedChatModels(provider) : []),
    [provider],
  );

  const { providers, isLoading } = useModelProvidersSettings({ projectId });
  // Keyed on content, not on the query result's identity: every refetch
  // (the key probe invalidates the list, so does a window focus) returns new
  // arrays, and the shared form resets its fields whenever its provider
  // changes, which threw away the key the customer had just typed.
  const storedSignature = JSON.stringify(
    providers?.[backendKey as keyof typeof providers] ?? null,
  );
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

  const [status, setStatus] = useState<GuidedConnectStatus>("idle");
  const [model, setModelState] = useState<string>(models[0] ?? "");
  const [manualModel, setManualModelState] = useState("");
  const [saveError, setSaveError] = useState<string | undefined>();

  const setRoleAssignment =
    api.modelProvider.setRoleAssignmentForScope.useMutation();
  const recordProvider = api.onboarding.recordProvider.useMutation();

  const finalModel = (provider.kind === "manual" ? manualModel : model).trim();
  const fullModel = finalModel ? `${backendKey}/${finalModel}` : "";
  const finishRef = useRef<(() => Promise<void>) | null>(null);

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
      setSaveError(
        error instanceof Error && error.message
          ? error.message
          : "Couldn't save this provider",
      );
      onFailed({ provider: backendKey, code: "save_failed" });
    },
  });

  const {
    validate,
    isValidating,
    validationError,
    validationErrorCode,
    clearError,
  } = useModelProviderApiKeyValidation(
    backendKey,
    state.customKeys,
    projectId,
    organizationId,
    state.scopes,
  );

  const { probeRequired, recordRefusal, clearRefusal } = useCredentialProbeGate(
    {
      customKeys: state.customKeys,
      resetKey: provider.id,
    },
  );

  // The model is chosen before Connect, so the form holds it when the save
  // reads its snapshot. Marking the provider as the default is what makes
  // the save write the picked model as the Default role at the
  // organization, on top of the seed's flagship. The form clears both
  // whenever its stored row changes (the list finishing its first load is
  // one such change), so the pick is applied again on the same row change.
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

  const setField = useCallback(
    (key: string, value: string) => {
      actions.setCustomKey(key, value);
      clearError();
      setSaveError(undefined);
    },
    [actions, clearError],
  );

  const setModel = useCallback((next: string) => setModelState(next), []);
  const setManualModel = useCallback(
    (next: string) => setManualModelState(next),
    [],
  );

  // A self-hosted server can carry the key in its environment. The form then
  // shows the mask instead of a key, and a save without a typed key keeps
  // using the server's; the panel says so rather than asking for a key it
  // does not need.
  const usesEnvironmentKey =
    isUsingEnvVars &&
    provider.fields.some(
      (field) =>
        field.secret && state.customKeys[field.key] === MASKED_KEY_PLACEHOLDER,
    );

  const ready =
    status === "idle" &&
    provider.fields.every(
      (field) =>
        field.optional || (state.customKeys[field.key]?.trim().length ?? 0) > 3,
    ) &&
    (provider.kind === "api-key"
      ? finalModel.length > 0
      : finalModel.length > 1);

  finishRef.current = async () => {
    try {
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
    } catch (error) {
      setStatus("idle");
      setSaveError(
        error instanceof Error && error.message
          ? error.message
          : "Couldn't save this provider",
      );
      onFailed({ provider: backendKey, code: "save_failed" });
      return;
    }
    setStatus("connected");
    onConnected({
      provider: backendKey,
      model: finalModel,
      kind: provider.kind,
    });
  };

  const connect = useCallback(async () => {
    if (!ready) return;
    setSaveError(undefined);
    clearError();

    if (probeRequired) {
      setStatus("checking");
      const valid = await validate();
      if (!valid) {
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
      setSaveError(
        error instanceof Error && error.message
          ? error.message
          : "Couldn't save this provider",
      );
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
    setModel,
    manualModel,
    setManualModel,
    status: isValidating && status === "idle" ? "checking" : status,
    ready,
    usesEnvironmentKey,
    /** The refusal (or the save failure), shown on the credential field. */
    error: validationError ?? saveError,
    connect,
  };
}

export type GuidedProviderConnect = ReturnType<typeof useGuidedProviderConnect>;
