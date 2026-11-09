import { VStack } from "@langwatch/design-system/primitives";
import type { EditModelProviderFormProps } from "@langwatch/model-provider-client";
import type React from "react";

import type { useGuidedSave } from "../../behavior/use-guided-save.ts";
import type {
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "../../behavior/use-model-provider-form.ts";
import {
  areGuidedFieldsFilled,
  guidedPanelSpecFor,
  isModelRefusal,
} from "../../model/guided-credential-fields.ts";
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
  refusalCode,
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
  /** The refusal's error code, which decides the field it reads under. */
  refusalCode: string | undefined;
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
  const modelRefusal = isModelRefusal({ code: refusalCode }) ? refusal : undefined;

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
    guidedSave.pick(model);
    if (refusal) clearRefusal();
  };
  const typeModel = (model: string) => {
    guidedSave.type(model);
    if (refusal) clearRefusal();
  };

  return (
    <VStack align="stretch" gap={4} width="full">
      {header}
      <VStack align="stretch" gap={3}>
        <GuidedCredentialFields
          spec={spec}
          values={state.customKeys}
          fieldErrors={fieldErrors}
          refusal={modelRefusal ? undefined : refusal}
          serverKeyHint={
            showServerKeyHint ? <GuidedServerKeyHint providerName={spec.name} /> : null
          }
          disabled={locked}
          onChange={changeCredential}
        />
        <GuidedChatModelField
          guidedModels={guidedSave.models}
          pickedModel={guidedSave.chatModel}
          typedModel={guidedSave.typed}
          onPick={pickModel}
          onType={typeModel}
          locked={locked}
          providerName={spec.name}
          modelPlaceholder={spec.modelPlaceholder}
          deploymentField={spec.deploymentField}
          error={modelRefusal}
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
