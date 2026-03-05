import { Button, Field, HStack, NativeSelect, Spinner, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Switch } from "../../../../../components/ui/switch";
import { useModelProviderApiKeyValidation } from "../../../../../hooks/useModelProviderApiKeyValidation";
import { useModelProviderFields } from "../../../../../hooks/useModelProviderFields";
import { useModelProviderForm } from "../../../../../hooks/useModelProviderForm";
import { useModelProvidersSettings } from "../../../../../hooks/useModelProvidersSettings";
import { useOrganizationTeamProject } from "../../../../../hooks/useOrganizationTeamProject";
import {
  getProviderModelOptions,
  type MaybeStoredModelProvider,
  modelProviders as modelProvidersRegistry,
} from "../../../../../server/modelProviders/registry";
import { createLogger } from "../../../../../utils/logger";
import {
  hasUserEnteredNewApiKey,
  hasUserModifiedNonApiKeyFields,
} from "../../../../../utils/modelProviderHelpers";
import {
  parseZodFieldErrors,
  type ZodErrorStructure,
} from "../../../../../utils/zod";
import {
  getModelProvider,
  modelProviderRegistry,
} from "../../../regions/model-providers/registry";
import type { ModelProviderKey } from "../../../regions/model-providers/types";
import { DocsLinks } from "../observability/DocsLinks";
import { ModelProviderCredentialFields } from "./ModelProviderCredentialFields";
import { CustomModelInputSection } from "../../../../../components/settings/ModelProviderCustomModelInput";
import { ModelProviderExtraHeaders } from "./ModelProviderExtraHeaders";

const logger = createLogger("ModelProviderSetup");

/**
 * Providers whose registry already includes well-known models.
 * These don't need the custom model add/edit UI during onboarding.
 */
const PROVIDERS_WITH_WELL_KNOWN_MODELS = new Set([
  "openai",
  "anthropic",
  "gemini",
  "deepseek",
  "xai",
]);

interface ModelProviderSetupProps {
  modelProviderKey: ModelProviderKey;
  variant: "evaluations" | "prompts";
}

const variantToDocsMapping: Record<"evaluations" | "prompts", string> = {
  evaluations: "/llm-evaluation/overview",
  prompts: "/prompt-management/overview",
};

export const ModelProviderSetup: React.FC<ModelProviderSetupProps> = ({
  modelProviderKey,
  variant,
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
        logger.warn(
          {
            requestedKey: modelProviderKey,
            fallbackKey: fallbackProviderMeta.key,
          },
          "Model provider metadata not found. Falling back to first available provider",
        );
      } else {
        logger.warn(
          {
            requestedKey: requestedMeta.key,
            fallbackKey: fallbackProviderMeta.key,
          },
          "Model provider metadata missing backend key. Falling back to first available provider",
        );
      }
    } else {
      logger.error(
        {
          requestedKey: modelProviderKey,
        },
        "Model provider metadata missing and no fallback provider available",
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
  }, [
    fallbackProviderMeta?.backendModelProviderKey,
    meta?.backendModelProviderKey,
  ]);
  const { providers, isLoading } = useModelProvidersSettings({
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

  // Detect if provider is using environment variables (enabled but no stored customKeys)
  const isUsingEnvVars =
    provider.enabled &&
    (!provider.customKeys ||
      Object.keys(provider.customKeys as Record<string, unknown>).length === 0);

  const projectForForm = useMemo(
    () => ({
      defaultModel: meta?.defaultModel ?? project?.defaultModel ?? null,
      topicClusteringModel: project?.topicClusteringModel ?? null,
      embeddingsModel: project?.embeddingsModel ?? null,
    }),
    [
      meta?.defaultModel,
      project?.defaultModel,
      project?.topicClusteringModel,
      project?.embeddingsModel,
    ],
  );

  const [state, actions] = useModelProviderForm({
    provider,
    projectId,
    project: projectForForm,
    isUsingEnvVars,
    onSuccess: () => {
      if (variant === "evaluations") {
        window.location.href = "/@project/evaluations";
      } else if (variant === "prompts") {
        window.location.href = "/@project/prompts";
      } else {
        window.location.href = "/";
      }
    },
  });

  // Compute chat model options for the model settings component
  const chatModelOptions = useMemo(
    () => getProviderModelOptions(backendModelProviderKey, "chat"),
    [backendModelProviderKey],
  );

  const { fields: derivedFields } = useModelProviderFields(
    backendModelProviderKey,
  );
  const [openAiValidationError, setOpenAiValidationError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // API key validation hook
  const {
    validate: validateApiKey,
    validateWithCustomUrl,
    isValidating: isValidatingApiKey,
    validationError: apiKeyValidationError,
    clearError: clearApiKeyError,
  } = useModelProviderApiKeyValidation(
    backendModelProviderKey,
    state.customKeys,
    projectId,
  );

  useEffect(() => {
    setOpenAiValidationError(void 0);
    setFieldErrors({});
    clearApiKeyError();
  }, [modelProviderKey, clearApiKeyError]);

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
    if (baseUrl === getModelProvider("open_ai")?.defaultBaseUrl && !apiKey) {
      setOpenAiValidationError(
        "API Key is required when using the default OpenAI base URL",
      );
      return false;
    }

    handleOpenAiValidationClear();
    return true;
  }, [isOpenAiProvider, state.customKeys, handleOpenAiValidationClear]);

  const handleSaveAndContinue = useCallback(async () => {
    // Clear previous errors
    setFieldErrors({});
    handleOpenAiValidationClear();
    clearApiKeyError();

    // Run OpenAI-specific validation
    if (!validateOpenAi()) {
      return;
    }

    // Get provider definition for schema and endpoint key
    const providerDefinition = backendModelProviderKey
      ? modelProvidersRegistry[backendModelProviderKey]
      : void 0;

    // Get custom base URL if provided
    const endpointKey = providerDefinition?.endpointKey;
    const customBaseUrl = endpointKey
      ? state.customKeys[endpointKey]?.trim() || undefined
      : undefined;

    // Check if user entered a new API key
    const userEnteredNewApiKey = hasUserEnteredNewApiKey(state.customKeys);

    // Check if user modified non-API-key fields (like URLs)
    const hasNonApiKeyChanges = hasUserModifiedNonApiKeyFields(
      state.customKeys,
      state.initialKeys,
    );

    // Validate keys according to schema before submitting
    if (
      providerDefinition?.keysSchema &&
      (!isUsingEnvVars || hasNonApiKeyChanges)
    ) {
      const keysSchema = z.union([
        providerDefinition.keysSchema,
        z.object({ MANAGED: z.string() }),
      ]);

      const keysToValidate: Record<string, unknown> = { ...state.customKeys };
      const result = keysSchema.safeParse(keysToValidate);

      if (!result.success) {
        const parsedErrors = parseZodFieldErrors(
          result.error as ZodErrorStructure,
        );
        setFieldErrors(parsedErrors);
        return;
      }
    }

    const submitForm = () => {
      void actions
        .setEnabled(true)
        .then(() => actions.submit())
        .catch((err) =>
          logger.error(err, "failed to submit model provider settings"),
        );
    };

    // ALWAYS validate API key on save
    if (userEnteredNewApiKey) {
      // User entered new API key - validate it (against custom or default URL)
      const isValid = await validateApiKey();
      if (!isValid) return;
    } else if (customBaseUrl) {
      // Stored/env key + custom URL - validate against custom URL
      const isValid = await validateWithCustomUrl(customBaseUrl);
      if (!isValid) return;
    } else {
      // Stored/env key + default URL - validate against default URL
      const isValid = await validateWithCustomUrl();
      if (!isValid) return;
    }

    submitForm();
  }, [
    validateOpenAi,
    actions,
    backendModelProviderKey,
    state.customKeys,
    state.initialKeys,
    handleOpenAiValidationClear,
    clearApiKeyError,
    isUsingEnvVars,
    validateApiKey,
    validateWithCustomUrl,
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
          Enter your API credentials for {meta.label}
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
            apiKeyValidationError={apiKeyValidationError}
            isOpenAiProvider={isOpenAiProvider}
            onCustomKeyChange={handleCustomKeyChange}
            onFieldErrorClear={handleFieldErrorClear}
            onOpenAiValidationClear={handleOpenAiValidationClear}
            onApiKeyValidationClear={clearApiKeyError}
          />

          {(backendModelProviderKey === "azure" ||
            backendModelProviderKey === "custom") && (
            <ModelProviderExtraHeaders
              headers={state.extraHeaders}
              onHeaderKeyChange={actions.setExtraHeaderKey}
              onHeaderValueChange={actions.setExtraHeaderValue}
              onRemoveHeader={actions.removeExtraHeader}
              onAddHeader={actions.addExtraHeader}
            />
          )}

          {PROVIDERS_WITH_WELL_KNOWN_MODELS.has(backendModelProviderKey) ? (
            <Field.Root>
              <Field.Label>Default Chat Model</Field.Label>
              <NativeSelect.Root size="sm" bg="bg.muted/40">
                <NativeSelect.Field
                  value={state.projectDefaultModel ?? ""}
                  onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                    actions.setProjectDefaultModel(
                      event.target.value || null,
                    )
                  }
                >
                  <option value="">Select default model...</option>
                  {chatModelOptions.map((model) => (
                    <option key={model.value} value={model.value}>
                      {model.label}
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
              <Field.HelperText>
                This model will be used for evaluations, prompt optimization,
                and dataset generation.
              </Field.HelperText>
            </Field.Root>
          ) : (
            <VStack align="stretch" gap={4}>
              <CustomModelInputSection
                state={state}
                actions={actions}
                provider={provider}
                dialogBackground="bg.surface"
                showRegistryLink={false}
              />
              <Field.Root>
                <Field.Label>Default Chat Model</Field.Label>
                <NativeSelect.Root size="sm" bg="bg.muted/40">
                  <NativeSelect.Field
                    value={state.projectDefaultModel ?? ""}
                    onChange={(
                      event: React.ChangeEvent<HTMLSelectElement>,
                    ) =>
                      actions.setProjectDefaultModel(
                        event.target.value || null,
                      )
                    }
                  >
                    <option value="">Select default model...</option>
                    {state.customModels.map((model) => (
                      <option key={model.modelId} value={model.modelId}>
                        {model.displayName}
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
                <Field.HelperText>
                  This model will be used for evaluations, prompt
                  optimization, and dataset generation.
                </Field.HelperText>
              </Field.Root>
            </VStack>
          )}

          <DocsLinks
            docs={{
              external: meta.externalDocsUrl,
              internal: variantToDocsMapping[variant],
            }}
            label={meta.label}
          />

          <HStack justify="end">
            <Button
              colorPalette="orange"
              onClick={handleSaveAndContinue}
              loading={state.isSaving || isValidatingApiKey}
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
