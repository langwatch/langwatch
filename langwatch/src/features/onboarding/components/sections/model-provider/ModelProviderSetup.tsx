import React, { useMemo, useState, useCallback, useEffect } from "react";
import { VStack, HStack, Button, Text, Field, Spinner } from "@chakra-ui/react";
import { z } from "zod";
import { Switch } from "../../../../../components/ui/switch";
import {
  getModelProvider,
  modelProviderRegistry,
} from "../../../regions/model-providers/registry";
import type { ModelProviderKey } from "../../../regions/model-providers/types";
import { useOrganizationTeamProject } from "../../../../../hooks/useOrganizationTeamProject";
import { useModelProvidersSettings } from "../../../../../hooks/useModelProvidersSettings";
import { useModelProviderForm } from "../../../../../hooks/useModelProviderForm";
import { useModelProviderFields } from "../../../../../hooks/useModelProviderFields";
import { DocsLinks } from "../observability/DocsLinks";
import {
  modelProviders as modelProvidersRegistry,
  type MaybeStoredModelProvider,
} from "../../../../../server/modelProviders/registry";
import {
  parseZodFieldErrors,
  type ZodErrorStructure,
} from "../../../../../utils/zod";
import { ModelProviderCredentialFields } from "./ModelProviderCredentialFields";
import { ModelProviderExtraHeaders } from "./ModelProviderExtraHeaders";
import { easyCatch } from "../../../../../utils/easyCatch";
import { ModelProviderModelSettings } from "./ModelProviderModelSettings";

interface ModelProviderSetupProps {
  modelProviderKey: ModelProviderKey;
}

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

export const ModelProviderSetup: React.FC<ModelProviderSetupProps> = ({
  modelProviderKey,
}) => {
  const fallbackProviderMeta = useMemo(
    () =>
      modelProviderRegistry.find((providerMeta) =>
        Boolean(providerMeta.backendModelProviderKey),
      ),
    [],
  );

  const meta = useMemo(() => {
    const requestedMeta = getModelProvider(modelProviderKey);

    if (requestedMeta?.backendModelProviderKey) {
      return requestedMeta;
    }

    if (fallbackProviderMeta?.backendModelProviderKey) {
      if (!requestedMeta) {
        console.warn(
          "Model provider metadata not found. Falling back to first available provider",
          {
            requestedKey: modelProviderKey,
            fallbackKey: fallbackProviderMeta.key,
          },
        );
      } else {
        console.warn(
          "Model provider metadata missing backend key. Falling back to first available provider",
          {
            requestedKey: requestedMeta.key,
            fallbackKey: fallbackProviderMeta.key,
          },
        );
      }
    } else {
      console.error(
        "Model provider metadata missing and no fallback provider available",
        {
          requestedKey: modelProviderKey,
        },
      );
    }

    return fallbackProviderMeta ?? requestedMeta;
  }, [fallbackProviderMeta, modelProviderKey]);
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id;

  const backendModelProviderKey = useMemo(() => {
    if (meta?.backendModelProviderKey) {
      return meta.backendModelProviderKey;
    }

    return fallbackProviderMeta?.backendModelProviderKey ?? "openai";
  }, [fallbackProviderMeta?.backendModelProviderKey, meta?.backendModelProviderKey]);
  const { providers, isLoading, refetch } = useModelProvidersSettings({
    projectId,
  });

  const provider: MaybeStoredModelProvider = useMemo(() => {
    const existing = providers
      ? providers[backendModelProviderKey as keyof typeof providers]
      : void 0;
    if (existing) return existing;

    return {
      provider: backendModelProviderKey,
      enabled: false,
      customKeys: null,
      models: null,
      embeddingsModels: null,
      disabledByDefault: true,
      deploymentMapping: null,
      extraHeaders: [],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendModelProviderKey, providers]);

  const [state, actions] = useModelProviderForm({
    provider,
    projectId,
    projectDefaultModel: meta?.defaultModel ?? project?.defaultModel ?? null,
    onSuccess: () => {
      refetch().catch(err => easyCatch(err, "ModelProviderSetup.onSuccess"));
    },
  });

  const { fields: derivedFields } = useModelProviderFields(backendModelProviderKey);
  const [openAiValidationError, setOpenAiValidationError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setOpenAiValidationError(void 0);
    setFieldErrors({});
  }, [modelProviderKey]);

  const isOpenAiProvider = backendModelProviderKey === "openai";

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
    setOpenAiValidationError(void 0);
  }, []);

  const validateOpenAi = useCallback(() => {
    if (!isOpenAiProvider) return true;

    const apiKey = state.customKeys.OPENAI_API_KEY?.trim() ?? "";
    const baseUrl = state.customKeys.OPENAI_BASE_URL?.trim() ?? "";

    // Both empty
    if (!apiKey && !baseUrl) {
      setOpenAiValidationError("Either API Key or Base URL must be provided");
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
  }, [isOpenAiProvider, state.customKeys, handleOpenAiValidationClear]);

  const handleSaveAndContinue = useCallback(() => {
    if (!validateOpenAi()) {
      return;
    }

    // Clear previous errors
    setFieldErrors({});
    handleOpenAiValidationClear();

    // Validate keys according to schema before submitting
    const providerDefinition = backendModelProviderKey
      ? modelProvidersRegistry[backendModelProviderKey]
      : void 0;

    if (providerDefinition?.keysSchema) {
      const keysSchema = z.union([
        providerDefinition.keysSchema,
        z.object({ MANAGED: z.string() }),
      ]);

      const keysToValidate: Record<string, unknown> = { ...state.customKeys };
      const result = keysSchema.safeParse(keysToValidate);

      if (!result.success) {
        // Parse the Zod error to get field-specific errors
        const parsedErrors = parseZodFieldErrors(
          result.error as ZodErrorStructure,
        );
        setFieldErrors(parsedErrors);
        return;
      }
    }

    void actions
      .setEnabled(true)
      .then(() => actions.submit())
      .catch(err => easyCatch(err, "ModelProviderSetup.handleSaveAndContinue"));
  }, [
    validateOpenAi,
    actions,
    backendModelProviderKey,
    state.customKeys,
    handleOpenAiValidationClear,
  ]);

  if (!meta || !backendModelProviderKey) return null;

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
          {backendModelProviderKey === "azure" && (
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

          {(backendModelProviderKey === "azure" || backendModelProviderKey === "custom") && (
            <ModelProviderExtraHeaders
              headers={state.extraHeaders}
              onHeaderKeyChange={actions.setExtraHeaderKey}
              onHeaderValueChange={actions.setExtraHeaderValue}
              onRemoveHeader={actions.removeExtraHeader}
              onAddHeader={actions.addExtraHeader}
            />
          )}

          <ModelProviderModelSettings
            modelProviderKey={modelProviderKey}
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
};
