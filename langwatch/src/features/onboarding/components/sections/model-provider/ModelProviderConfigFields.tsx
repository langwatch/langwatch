import React, { useMemo, useState, useCallback, useEffect } from "react";
import {
  VStack,
  HStack,
  Button,
  Text,
  Field,
  Spinner,
} from "@chakra-ui/react";
import { z } from "zod";
import { Switch } from "../../../../../components/ui/switch";
import { getModelProvider } from "../../../regions/model-providers/registry";
import type { ModelProviderKey } from "../../../regions/model-providers/types";
import { useOrganizationTeamProject } from "../../../../../hooks/useOrganizationTeamProject";
import { useModelProvidersSettings } from "../../../../../hooks/useModelProvidersSettings";
import { useModelProviderForm } from "../../../../../hooks/useModelProviderForm";
import { useModelProviderFields } from "../../../../../hooks/useModelProviderFields";
import { DocsLinks } from "../observability/DocsLinks";
import { modelProviders as modelProvidersRegistry } from "../../../../../server/modelProviders/registry";
import {
  parseZodFieldErrors,
  type ZodErrorStructure,
} from "../../../../../utils/zod";
import { ModelProviderCredentialFields } from "./ModelProviderCredentialFields";
import { ModelProviderExtraHeaders } from "./ModelProviderExtraHeaders";
import { ModelProviderModelSettings } from "./ModelProviderModelSettings";

interface ModelProviderConfigFieldsProps {
  modelProviderKey: ModelProviderKey;
}

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

export const ModelProviderConfigFields: React.FC<ModelProviderConfigFieldsProps> = ({
  modelProviderKey,
}) => {
  const meta = getModelProvider(modelProviderKey);
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;

  const backendKey = meta?.backendKey;
  const { providers, isLoading, refetch } = useModelProvidersSettings({
    projectId,
  });

  const provider = useMemo(() => {
    if (!backendKey) return void 0;

    const existing = providers?.[backendKey as keyof typeof providers];
    if (existing) return existing;

    return {
      provider: backendKey,
      enabled: false,
      customKeys: null,
      models: null,
      embeddingsModels: null,
      disabledByDefault: true,
      extraHeaders: [],
    } as any;
  }, [backendKey, providers]);

  const [state, actions] = useModelProviderForm({
    provider,
    projectId,
    projectDefaultModel: meta?.defaultModel ?? project?.defaultModel ?? null,
    onSuccess: () => {
      void refetch();
    },
  });

  const { fields: derivedFields } = useModelProviderFields(backendKey as any);
  const [openAiValidationError, setOpenAiValidationError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setOpenAiValidationError(void 0);
    setFieldErrors({});
  }, [modelProviderKey]);

  const isOpenAiProvider = backendKey === "openai";

  const handleCustomKeyChange = useCallback(
    (key: string, value: string) => {
      actions.setCustomKey(key, value);
    },
    [actions],
  );

  const handleFieldErrorClear = useCallback((key: string) => {
    setFieldErrors((previous) => {
      if (!previous[key]) {
        return previous;
      }
      const updated = { ...previous };
      delete updated[key];
      return updated;
    });
  }, []);

  const handleOpenAiValidationClear = useCallback(() => {
    setOpenAiValidationError(undefined);
  }, []);

  const validateOpenAi = useCallback(() => {
    if (!isOpenAiProvider) return true;

    const apiKey = state.customKeys.OPENAI_API_KEY?.trim() ?? "";
    const baseUrl = state.customKeys.OPENAI_BASE_URL?.trim() ?? "";

    // Both empty
    if (!apiKey && !baseUrl) {
      setOpenAiValidationError(
        "Either API Key or Base URL must be provided",
      );
      return false;
    }

    // Base URL is set to default OpenAI URL, but no API key
    if (baseUrl === OPENAI_DEFAULT_BASE_URL && !apiKey) {
      setOpenAiValidationError(
        "API Key is required when using the default OpenAI base URL",
      );
      return false;
    }

    handleOpenAiValidationClear();
    return true;
  }, [
    isOpenAiProvider,
    state.customKeys,
    handleOpenAiValidationClear,
  ]);

  const handleSaveAndContinue = useCallback(() => {
    if (!validateOpenAi()) {
      return;
    }

    // Clear previous errors
    setFieldErrors({});
    handleOpenAiValidationClear();

    // Validate keys according to schema before submitting
    const providerDefinition = backendKey
      ? modelProvidersRegistry[backendKey as keyof typeof modelProvidersRegistry]
      : undefined;

    if (providerDefinition?.keysSchema) {
      const keysSchema = z.union([
        providerDefinition.keysSchema,
        z.object({ MANAGED: z.string() }),
      ]);

      const keysToValidate: Record<string, unknown> = { ...state.customKeys };
      const result = keysSchema.safeParse(keysToValidate);

      if (!result.success) {
        // Parse the Zod error to get field-specific errors
        const parsedErrors = parseZodFieldErrors(result.error as ZodErrorStructure);
        setFieldErrors(parsedErrors);
        return;
      }
    }

    void actions.setEnabled(true).then(() => actions.submit());
  }, [
    validateOpenAi,
    actions,
    backendKey,
    state.customKeys,
    handleOpenAiValidationClear,
  ]);

  if (!meta || !backendKey) return null;

  if (isLoading || !provider) {
    return (
      <VStack align="stretch" gap={3}>
        <Spinner />
      </VStack>
    );
  }

  return (
    <VStack align="stretch" gap={0}>
      <VStack align="stretch" gap={0}>
        <Text fontSize="md" fontWeight="semibold">
          Configure {meta.label}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          Enter your API credentials and allowed models for {meta.label}
        </Text>
      </VStack>

      <VStack align="stretch" gap={4}>
        <HStack gap={6}>
          {backendKey === "azure" && (
            <Field.Root>
              <Switch
                checked={state.useApiGateway}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  actions.setUseApiGateway(e.target.checked)
                }
              >
                Use API Gateway
              </Switch>
            </Field.Root>
          )}
        </HStack>

        <>
          <ModelProviderCredentialFields
            displayKeys={state.displayKeys}
            customKeys={state.customKeys}
            derivedFields={derivedFields}
            fieldMetadata={meta.fieldMetadata}
            fieldErrors={fieldErrors}
            openAiValidationError={openAiValidationError}
            isOpenAiProvider={isOpenAiProvider}
            onCustomKeyChange={handleCustomKeyChange}
            onFieldErrorClear={handleFieldErrorClear}
            onOpenAiValidationClear={handleOpenAiValidationClear}
          />

          {(backendKey === "azure" || backendKey === "custom") && (
            <ModelProviderExtraHeaders
              headers={state.extraHeaders}
              onHeaderKeyChange={actions.setExtraHeaderKey}
              onHeaderValueChange={actions.setExtraHeaderValue}
              onRemoveHeader={actions.removeExtraHeader}
              onAddHeader={actions.addExtraHeader}
            />
          )}

          <ModelProviderModelSettings
            customModels={state.customModels}
            chatModelOptions={state.chatModelOptions}
            defaultModel={state.defaultModel}
            onCustomModelsChange={actions.setCustomModels}
            onDefaultModelChange={actions.setDefaultModel}
          />

          <DocsLinks docs={meta.docs} label={meta.label} />

          <HStack justify="end">
            <Button
              colorPalette="orange"
              onClick={handleSaveAndContinue}
              loading={state.isSaving}
              variant="surface"
              size="sm"
            >
              Save
            </Button>
          </HStack>
        </>
      </VStack>
    </VStack>
  );
}
