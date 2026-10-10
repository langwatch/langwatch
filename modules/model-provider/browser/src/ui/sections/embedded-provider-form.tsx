import { Link } from "@langwatch/browser-host/link";
import {
  Button,
  Field,
  HStack,
  NativeSelect,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import {
  getProviderModelOptions,
  type ModelProviderEditorValue,
} from "@langwatch/model-provider-contract";
import { BookOpen, ExternalLink } from "lucide-react";
import type React from "react";
import type { ReactNode } from "react";

import type {
  UseModelProviderFormActions,
  UseModelProviderFormState,
} from "../../behavior/use-model-provider-form.ts";
import {
  findProviderDocsUrl,
  hasWellKnownModels,
  LANGWATCH_INTRODUCTION_DOCS,
} from "../../model/embedded-provider-setup.ts";
import { CodexSignIn } from "./codex-sign-in.tsx";
import { EmbeddedCredentialFields } from "./embedded-credential-fields.tsx";
import { CustomModelInputSection } from "./model-provider-custom-model-input.tsx";
import { ExtraHeadersSection } from "./model-provider-extra-headers-section.tsx";

const DEFAULT_MODEL_HELPER =
  "This model will be used for evaluations, prompt optimization, and dataset generation.";

/**
 * Langy's "needs a model" setup: heading, credentials, default chat model and Save. Name, scope
 * and advanced settings stay in the drawer; the save lands at the widest scope the caller manages.
 * Spec: specs/langy/langy-inline-model-setup.feature
 */
export function EmbeddedProviderForm({
  provider,
  providerName,
  isOAuthDeviceProvider,
  state,
  actions,
  azureGatewaySwitch,
  fieldErrors,
  setFieldErrors,
  refusal,
  clearRefusal,
  isBusy,
  canResolveTarget,
  saveLabel,
  onSave,
  projectId,
  onConnected,
  onFailed,
}: {
  provider: ModelProviderEditorValue;
  providerName: string;
  isOAuthDeviceProvider: boolean;
  state: UseModelProviderFormState;
  actions: UseModelProviderFormActions;
  azureGatewaySwitch: ReactNode;
  fieldErrors: Record<string, string>;
  setFieldErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  refusal: string | undefined;
  clearRefusal: () => void;
  isBusy: boolean;
  canResolveTarget: boolean;
  saveLabel: string;
  onSave: () => void;
  projectId: string;
  onConnected: () => void;
  onFailed: (code: string) => void;
}) {
  if (isOAuthDeviceProvider) {
    return (
      <VStack align="stretch" gap={2} width="full">
        <Text fontSize="md" fontWeight="semibold">
          Connect {providerName}
        </Text>
        <CodexSignIn
          projectId={projectId}
          scopes={state.scopes}
          setAsCodingDefaults
          onFailed={onFailed}
          onConnected={onConnected}
        />
      </VStack>
    );
  }

  return (
    <VStack align="stretch" gap={0} width="full">
      <VStack align="stretch" gap={0}>
        <Text fontSize="md" fontWeight="semibold">
          Configure {providerName}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          Enter your API credentials for {providerName}
        </Text>
      </VStack>

      <VStack align="stretch" gap={4} paddingTop={4}>
        {azureGatewaySwitch}
        <EmbeddedCredentialFields
          providerKey={provider.provider}
          state={state}
          actions={actions}
          fieldErrors={fieldErrors}
          setFieldErrors={setFieldErrors}
          refusal={refusal}
          clearRefusal={clearRefusal}
        />
        <ExtraHeadersSection state={state} actions={actions} provider={provider} />
        <EmbeddedDefaultModelField provider={provider} state={state} actions={actions} />
        <EmbeddedDocsLinks providerKey={provider.provider} providerName={providerName} />
        <HStack justify="end">
          <Button
            colorPalette="orange"
            size="sm"
            onClick={onSave}
            loading={isBusy}
            disabled={!canResolveTarget}
            data-testid="model-provider-save"
          >
            {saveLabel}
          </Button>
        </HStack>
      </VStack>
    </VStack>
  );
}

/** Registry models for providers with a known list; otherwise the models the reader adds. */
function EmbeddedDefaultModelField({
  provider,
  state,
  actions,
}: {
  provider: ModelProviderEditorValue;
  state: UseModelProviderFormState;
  actions: UseModelProviderFormActions;
}) {
  const providerKey = provider.provider;
  const wellKnown = hasWellKnownModels(providerKey);
  const options = wellKnown
    ? getProviderModelOptions(providerKey, "chat")
    : state.customModels.map((model) => ({ value: model.modelId, label: model.displayName }));

  const pick = (value: string) => {
    actions.setUseAsDefaultProvider(Boolean(value));
    actions.setProjectDefaultModel(value || null);
  };

  const field = (
    <Field.Root>
      <Field.Label>Default Chat Model</Field.Label>
      <NativeSelect.Root size="sm" bg="bg.muted/40">
        <NativeSelect.Field
          aria-label="Default Chat Model"
          value={state.projectDefaultModel ?? ""}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => pick(event.target.value)}
        >
          <option value="">Select default model...</option>
          {options.map((model) => (
            <option key={model.value} value={`${providerKey}/${model.value}`}>
              {model.label}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      <Field.HelperText>{DEFAULT_MODEL_HELPER}</Field.HelperText>
    </Field.Root>
  );

  if (wellKnown) return field;

  return (
    <VStack align="stretch" gap={4}>
      <CustomModelInputSection
        state={state}
        actions={actions}
        provider={provider}
        dialogBackground="bg.card"
        showRegistryLink={false}
      />
      {field}
    </VStack>
  );
}

function EmbeddedDocsLinks({
  providerKey,
  providerName,
}: {
  providerKey: string;
  providerName: string;
}) {
  const external = findProviderDocsUrl(providerKey);
  return (
    <HStack gap={3} color="fg.muted" fontSize="xs" align="center" pt={1}>
      <Link href={LANGWATCH_INTRODUCTION_DOCS} isExternal>
        <HStack gap={1} _hover={{ color: "fg" }} transition="color 0.2s">
          <BookOpen size={12} />
          <Text>LangWatch Docs</Text>
        </HStack>
      </Link>
      {external ? (
        <>
          <Text aria-hidden>•</Text>
          <Link href={external} isExternal>
            <HStack gap={1} _hover={{ color: "fg" }} transition="color 0.2s">
              <ExternalLink size={12} />
              <Text>{providerName} Docs</Text>
            </HStack>
          </Link>
        </>
      ) : null}
    </HStack>
  );
}
