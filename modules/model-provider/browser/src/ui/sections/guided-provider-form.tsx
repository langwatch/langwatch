import { VStack } from "@langwatch/design-system/primitives";
import type { EditModelProviderFormProps } from "@langwatch/model-provider-client";
import type React from "react";

import type { useGuidedSave } from "../../behavior/use-guided-save.ts";
import type {
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "../../behavior/use-model-provider-form.ts";
import { areGuidedFieldsFilled, guidedPanelSpecFor } from "../../model/guided-credential-fields.ts";
import { hasUserEnteredNewApiKey } from "../../model/model-provider-helpers.ts";
import { CodexSignIn } from "./codex-sign-in.tsx";
import { GuidedChatModelField } from "./guided-chat-model-field.tsx";
import {
  GuidedConnectButton,
  GuidedCredentialFields,
  GuidedPanelHeader,
  GuidedServerKeyHint,
} from "./guided-provider-panel.tsx";

/**
 * Onboarding's connect panel: header, the provider's starter credentials, the chat model and a
 * full-width Connect. Scope is not asked: a guided save lands at the organization.
 * Spec: specs/features/onboarding/guided-welcome-takeover.feature.
 */
export function GuidedProviderForm({
  providerKey,
  providerName,
  apiKeyField,
  state,
  actions,
  guidedSave,
  isOAuthDeviceProvider,
  isUsingEnvVars,
  isBusy,
  canResolveTarget,
  fieldErrors,
  setFieldErrors,
  refusal,
  clearRefusal,
  connectLabel,
  onConnect,
  projectId,
  onFailed,
}: {
  providerKey: string;
  providerName: string;
  apiKeyField: string | undefined;
  state: UseModelProviderFormState;
  actions: UseModelProviderFormActions;
  guidedSave: ReturnType<typeof useGuidedSave>;
  isOAuthDeviceProvider: boolean;
  isUsingEnvVars: boolean;
  isBusy: boolean;
  canResolveTarget: boolean;
  fieldErrors: Record<string, string>;
  setFieldErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  refusal: string | undefined;
  clearRefusal: () => void;
  connectLabel: string;
  onConnect: () => void;
  projectId: string;
  onFailed?: EditModelProviderFormProps["onFailed"];
}) {
  const spec = guidedPanelSpecFor({ providerKey, providerName, apiKeyField });
  const header = (
    <GuidedPanelHeader providerKey={providerKey} spec={spec} connected={guidedSave.connected} />
  );

  if (isOAuthDeviceProvider) {
    return (
      <VStack align="stretch" gap={4} width="full">
        {header}
        <CodexSignIn
          guided
          projectId={projectId}
          scopes={state.scopes}
          setAsCodingDefaults
          onFailed={(code) => onFailed?.({ provider: providerKey, code })}
          onConnected={() => guidedSave.onSaved?.()}
        />
      </VStack>
    );
  }

  const locked = isBusy || guidedSave.connected;
  const typedModel = guidedSave.models.length > 0 || Boolean(guidedSave.chatModel);
  const credentialsReady =
    isUsingEnvVars || areGuidedFieldsFilled({ fields: spec.fields, values: state.customKeys });
  const showServerKeyHint = isUsingEnvVars && !hasUserEnteredNewApiKey(state.customKeys);

  const changeCredential = (key: string, value: string) => {
    actions.setCustomKey(key, value);
    if (fieldErrors[key]) {
      setFieldErrors((previous) => {
        const { [key]: _cleared, ...rest } = previous;
        return rest;
      });
    }
    if (refusal) clearRefusal();
  };

  const pickModel = (model: string) => {
    if (guidedSave.models.length > 0) {
      guidedSave.pick(model);
      return;
    }
    const typed = model.trim();
    guidedSave.pick(typed || undefined);
    actions.setCustomModels(typed ? [{ modelId: typed, displayName: typed, mode: "chat" }] : []);
  };

  return (
    <VStack align="stretch" gap={4} width="full">
      {header}
      <VStack align="stretch" gap={3}>
        <GuidedCredentialFields
          spec={spec}
          values={state.customKeys}
          fieldErrors={fieldErrors}
          refusal={refusal}
          serverKeyHint={
            showServerKeyHint ? <GuidedServerKeyHint providerName={spec.name} /> : null
          }
          disabled={locked}
          onChange={changeCredential}
        />
        <GuidedChatModelField
          guidedModels={guidedSave.models}
          pickedModel={guidedSave.chatModel}
          onPick={pickModel}
          locked={locked}
          providerName={spec.name}
          modelPlaceholder={spec.modelPlaceholder}
        />
        <GuidedConnectButton
          ready={canResolveTarget && credentialsReady && typedModel}
          busy={isBusy}
          connected={guidedSave.connected}
          label={connectLabel}
          onConnect={onConnect}
        />
      </VStack>
    </VStack>
  );
}
