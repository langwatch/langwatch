import {
  VStack,
  HStack,
  Button,
  Field,
  Grid,
  GridItem,
  Input,
  Text,
  createListCollection,
  Box,
} from "@chakra-ui/react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Plus, Trash2 } from "react-feather";
import CreatableSelect from "react-select/creatable";
import { z } from "zod";
import { useModelProvidersSettings } from "../../hooks/useModelProvidersSettings";
import {
  useModelProviderForm,
  type UseModelProviderFormState,
  type UseModelProviderFormActions,
  type ExtraHeader,
} from "../../hooks/useModelProviderForm";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { dependencies } from "../../injection/dependencies.client";
import {
  type MaybeStoredModelProvider,
  modelProviders as modelProvidersRegistry,
} from "../../server/modelProviders/registry";
import {
  DEFAULT_EMBEDDINGS_MODEL,
  DEFAULT_MODEL,
  DEFAULT_TOPIC_CLUSTERING_MODEL,
  KEY_CHECK,
} from "../../utils/constants";
import { parseZodFieldErrors, type ZodErrorStructure } from "../../utils/zod";
import { SmallLabel } from "../SmallLabel";
import { Switch } from "../ui/switch";
import { modelSelectorOptions } from "../ModelSelector";
import { modelProviderIcons } from "../../server/modelProviders/iconsMap";
import { Select } from "../ui/select";
import { Tooltip } from "../ui/tooltip";
import { isProviderUsedForDefaultModels } from "../../utils/modelProviderHelpers";

// ============================================================================
// SHARED COMPONENTS
// ============================================================================

/**
 * A specialized dropdown selector that displays models from a specific provider.
 * Shows the provider icon and formats model names by removing the provider prefix.
 * 
 * @param model - The currently selected model (in format "provider/model-name")
 * @param options - Array of available model options for this provider
 * @param onChange - Callback when a model is selected
 * @param providerKey - The provider identifier (e.g., "openai", "anthropic")
 */
const ProviderModelSelector = ({
  model,
  options,
  onChange,
  providerKey,
}: {
  model: string;
  options: string[];
  onChange: (model: string) => void;
  providerKey: string;
}) => {
  const providerIcon = modelProviderIcons[providerKey as keyof typeof modelProviderIcons];
  
  const items = options.map((option) => {
    const modelName = option.split("/").slice(1).join("/");
    return {
      label: modelName,
      value: option,
    };
  });

  const collection = createListCollection({ items });
  const selectedItem = items.find((item) => item.value === model);

  return (
    <Select.Root
      collection={collection}
      value={[model]}
      onValueChange={(change) => {
        const selectedValue = change.value[0];
        if (selectedValue) {
          onChange(selectedValue);
        }
      }}
      size="md"
      positioning={{ sameWidth: true }}
    >
      <Select.Trigger width="100%">
        <Select.ValueText>
          {() => (
            <HStack gap={2}>
              {providerIcon && <Box width="16px" minWidth="16px">{providerIcon}</Box>}
              <Text fontSize="14px" fontFamily="mono">
                {selectedItem?.label ?? model}
              </Text>
            </HStack>
          )}
        </Select.ValueText>
      </Select.Trigger>
      <Select.Content zIndex={2000}>
        {items.map((item) => (
          <Select.Item key={item.value} item={item}>
            <HStack gap={3}>
              {providerIcon && <Box width="14px" minWidth="14px">{providerIcon}</Box>}
              <Text fontSize="14px" fontFamily="mono">
                {item.label}
              </Text>
            </HStack>
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
};

/**
 * Renders credential input fields (API keys, endpoints, etc.) based on the provider's schema.
 * For managed providers (enterprise deployments), displays a managed provider component instead of input fields.
 * Handles field validation, password masking, and optional field indicators.
 * 
 * @param state - Form state containing credential values and display configuration
 * @param actions - Form actions for updating credential values
 * @param provider - The model provider configuration
 * @param fieldErrors - Map of field names to validation error messages
 * @param setFieldErrors - Function to update field errors
 * @param projectId - Optional project identifier for managed providers
 * @param organizationId - Optional organization identifier for managed providers
 */
const CredentialsSection = ({
  state,
  actions,
  provider,
  fieldErrors,
  setFieldErrors,
  projectId,
  organizationId,
}: {
  state: UseModelProviderFormState;
  actions: UseModelProviderFormActions;
  provider: MaybeStoredModelProvider;
  fieldErrors: Record<string, string>;
  setFieldErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  projectId?: string;
  organizationId?: string;
}) => {
  const ManagedModelProvider = dependencies.managedModelProviderComponent?.({
    projectId: projectId ?? "",
    organizationId: organizationId ?? "",
    provider,
  });
  // Type assertion needed: managedModelProviderComponent is dynamically injected and may vary by deployment
  const ManagedModelProviderAny = ManagedModelProvider as React.ComponentType<{ provider: MaybeStoredModelProvider }> | undefined;

  useEffect(() => {
    if (ManagedModelProviderAny) {
      actions.setManaged(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(state.customKeys)]);

  if (ManagedModelProviderAny) {
    return React.createElement(ManagedModelProviderAny, { provider });
  }

  return (
    <>
      <VStack align="stretch" gap={3} width="full">
        {Object.keys(state.displayKeys).map((key) => {
          // Access Zod schema internals to check if field is optional
          const zodSchema = state.displayKeys[key];
          const isOptional = zodSchema?._def?.typeName === "ZodOptional";
          const isPassword = KEY_CHECK.some((k) => key.includes(k));
          const isInvalid = Boolean(fieldErrors[key]);

          return (
            <Field.Root key={key} required={!isOptional} invalid={isInvalid} width="full">
              <SmallLabel>
                {key}
                {!isOptional && <Field.RequiredIndicator />}
              </SmallLabel>
              <Box width="full">
                <Input
                  value={state.customKeys[key] ?? ""}
                  onChange={(e) => {
                    actions.setCustomKey(key, e.target.value);
                    if (fieldErrors[key]) {
                      setFieldErrors(prev => {
                        const updated = { ...prev };
                        delete updated[key];
                        return updated;
                      });
                    }
                  }}
                  type={isPassword ? "password" : "text"}
                  autoComplete="off"
                  placeholder={isOptional ? "optional" : undefined}
                  width="full"
                />
              </Box>
              {fieldErrors[key] && (
                <Field.ErrorText>{fieldErrors[key]}</Field.ErrorText>
              )}
            </Field.Root>
          );
        })}
      </VStack>
      {state.errors.customKeysRoot && (
        <Field.Root invalid>
          <Field.ErrorText>{state.errors.customKeysRoot}</Field.ErrorText>
        </Field.Root>
      )}
    </>
  );
};

/**
 * Renders a section for adding custom HTTP headers to API requests.
 * Only visible for Azure and Custom providers that support additional headers.
 * Provides controls to add/remove headers and toggle visibility (concealment) of header values.
 * 
 * @param state - Form state containing extra headers configuration
 * @param actions - Form actions for managing extra headers
 * @param provider - The model provider configuration
 */
const ExtraHeadersSection = ({
  state,
  actions,
  provider,
}: {
  state: UseModelProviderFormState;
  actions: UseModelProviderFormActions;
  provider: MaybeStoredModelProvider;
}) => {
  if (provider.provider !== "azure" && provider.provider !== "custom") {
    return null;
  }

  return (
    <VStack width="full" align="start" paddingTop={4}>
      {state.extraHeaders.length > 0 && (
        <Grid
          templateColumns="auto auto auto auto"
          gap={4}
          rowGap={2}
          width="full"
        >
          <GridItem color="gray.500" colSpan={4}>
            <SmallLabel>Extra Headers</SmallLabel>
          </GridItem>
          {state.extraHeaders.map((h: ExtraHeader, index: number) => (
            <React.Fragment key={index}>
              <GridItem>
                <Input
                  value={h.key}
                  onChange={(e) =>
                    actions.setExtraHeaderKey(
                      index,
                      e.target.value,
                    )
                  }
                  placeholder="Header name"
                  autoComplete="off"
                  width="full"
                />
              </GridItem>
              <GridItem>
                <Input
                  value={h.value}
                  onChange={(e) =>
                    actions.setExtraHeaderValue(
                      index,
                      e.target.value,
                    )
                  }
                  type={h.concealed ? "password" : "text"}
                  placeholder="Header value"
                  autoComplete="off"
                  width="full"
                />
              </GridItem>
              <GridItem>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    actions.toggleExtraHeaderConcealed(index)
                  }
                >
                  {h.concealed ? (
                    <EyeOff size={16} />
                  ) : (
                    <Eye size={16} />
                  )}
                </Button>
              </GridItem>
              <GridItem>
                <Button
                  size="sm"
                  variant="ghost"
                  colorPalette="red"
                  onClick={() => actions.removeExtraHeader(index)}
                >
                  <Trash2 size={16} />
                </Button>
              </GridItem>
            </React.Fragment>
          ))}
        </Grid>
      )}

      <HStack width="full" justify="end">
        <Button
          size="xs"
          variant="outline"
          onClick={actions.addExtraHeader}
        >
          <Plus size={16} />
          Add Header
        </Button>
      </HStack>
    </VStack>
  );
};

/**
 * Renders a multi-input field for specifying custom model names.
 * Only visible for the "custom" provider type (e.g., LiteLLM proxy, self-hosted vLLM).
 * Users can add comma-separated model names or create them individually.
 * 
 * @param state - Form state containing custom model names
 * @param actions - Form actions for managing custom models
 * @param provider - The model provider configuration
 */
const CustomModelInputSection = ({
  state,
  actions,
  provider,
}: {
  state: UseModelProviderFormState;
  actions: UseModelProviderFormActions;
  provider: MaybeStoredModelProvider;
}) => {
  if (provider.provider !== "custom") {
    return null;
  }

  return (
    <VStack width="full" align="start" gap={2} paddingTop={4}>
      <SmallLabel>Models</SmallLabel>
      <Text fontSize="xs" color="gray.500">
      Use this option for LiteLLM proxy, self-hosted vLLM or any other model providers that supports the /chat/completions endpoint.
      </Text>
      <Box width="full">
        <CreatableSelect
          value={state.customModels}
          onChange={(v) => actions.setCustomModels(v ? [...v] : [])}
          onCreateOption={(text) => actions.addCustomModelsFromText(text)}
          isMulti
          options={[]}
          placeholder="Add custom model"
          styles={{
            control: (base) => ({
              ...base,
              minHeight: '40px',
            }),
          }}
        />
      </Box>
    </VStack>
  );
};

/**
 * Renders the "Use as default provider" toggle and default model selection fields.
 * When enabled, allows selection of default models for chat, topic clustering, and embeddings.
 * The toggle is disabled if the provider is currently in use or is the only enabled provider.
 * 
 * @param state - Form state containing default provider configuration and model selections
 * @param actions - Form actions for updating default provider settings
 * @param provider - The model provider configuration
 * @param enabledProvidersCount - Total number of currently enabled providers
 * @param project - Current project with default model settings
 */
const DefaultProviderSection = ({
  state,
  actions,
  provider,
  enabledProvidersCount,
  project,
}: {
  state: UseModelProviderFormState;
  actions: UseModelProviderFormActions;
  provider: MaybeStoredModelProvider;
  enabledProvidersCount: number;
  project: {
    defaultModel?: string | null;
    topicClusteringModel?: string | null;
    embeddingsModel?: string | null;
  } | null | undefined;
}) => {
  // Determine if toggle should be disabled
  const isUsedForDefaults = project ? isProviderUsedForDefaultModels(
    provider.provider,
    project.defaultModel ?? null,
    project.topicClusteringModel ?? null,
    project.embeddingsModel ?? null
  ) : false;
  const isOnlyEnabledProvider = enabledProvidersCount === 1;
  const isToggleDisabled = isUsedForDefaults || isOnlyEnabledProvider;

  // Generate tooltip message
  let tooltipMessage = "";
  if (isUsedForDefaults) {
    tooltipMessage =
      "This provider is currently being used for one or more default models and cannot be disabled from default usage.";
  } else if (isOnlyEnabledProvider) {
    tooltipMessage =
      "This is the only enabled provider and must be used as the default.";
  }

  // Get all models from modelSelectorOptions for this specific provider only
  const chatOptions = modelSelectorOptions
    .filter(
      (option) =>
        option.mode === "chat" &&
        option.value.startsWith(`${provider.provider}/`)
    )
    .map((option) => option.value);
  
  const embeddingOptions = modelSelectorOptions
    .filter(
      (option) =>
        option.mode === "embedding" &&
        option.value.startsWith(`${provider.provider}/`)
    )
    .map((option) => option.value);

  return (
    <VStack width="full" align="start" gap={4} paddingTop={4}>
      <Tooltip
        content={tooltipMessage}
        disabled={!isToggleDisabled}
        positioning={{ placement: "top", gutter: 8 }}
      >
        <Box width="fit-content">
          <Switch
            onCheckedChange={(details) => {
              actions.setUseAsDefaultProvider(details.checked);
            }}
            checked={state.useAsDefaultProvider}
            disabled={isToggleDisabled}
          >
            Use as default provider for models
          </Switch>
        </Box>
      </Tooltip>
      {state.useAsDefaultProvider && (
        <Text fontSize="xs" color="gray.500" marginTop={-2}>
          Configure the default models used for workflows, evaluations and other
          LangWatch features.
        </Text>
      )}

      {/* Default Models Selection - Only visible when toggle is enabled */}
      {state.useAsDefaultProvider && (
        <VStack
          width="full"
          align="start"
          gap={4}
          paddingLeft={4}
          borderLeftWidth="2px"
          borderLeftColor="gray.200"
        >
          {chatOptions.length > 0 ? (
            <>
              <Field.Root width="full">
                <SmallLabel>Default Model</SmallLabel>
                <Text fontSize="xs" color="gray.500" marginBottom={2}>
                  For general tasks within LangWatch
                </Text>
                <ProviderModelSelector
                  model={state.projectDefaultModel ?? chatOptions[0] ?? DEFAULT_MODEL}
                  options={chatOptions}
                  onChange={(model) => actions.setProjectDefaultModel(model)}
                  providerKey={provider.provider}
                />
              </Field.Root>

              <Field.Root width="full">
                <SmallLabel>Topic Clustering Model</SmallLabel>
                <Text fontSize="xs" color="gray.500" marginBottom={2}>
                  For generating topic names
                </Text>
                <ProviderModelSelector
                  model={
                    state.projectTopicClusteringModel ??
                    chatOptions[0] ??
                    DEFAULT_TOPIC_CLUSTERING_MODEL
                  }
                  options={chatOptions}
                  onChange={(model) =>
                    actions.setProjectTopicClusteringModel(model)
                  }
                  providerKey={provider.provider}
                />
              </Field.Root>
            </>
          ) : (
            <Text fontSize="sm" color="orange.500">
              No chat models available for this provider in the registry.
            </Text>
          )}

          {embeddingOptions.length > 0 ? (
            <Field.Root width="full">
              <SmallLabel>Embeddings Model</SmallLabel>
              <Text fontSize="xs" color="gray.500" marginBottom={2}>
                For embeddings to be used in topic clustering and evaluations
              </Text>
              <ProviderModelSelector
                model={state.projectEmbeddingsModel ?? embeddingOptions[0] ?? DEFAULT_EMBEDDINGS_MODEL}
                options={embeddingOptions}
                onChange={(model) => actions.setProjectEmbeddingsModel(model)}
                providerKey={provider.provider}
              />
            </Field.Root>
          ) : (
            <Text fontSize="sm" color="orange.500">
              No embedding models available for this provider in the registry.
            </Text>
          )}
        </VStack>
      )}
    </VStack>
  );
};



type AddModelProviderFormProps = {
  projectId?: string | undefined;
  organizationId?: string | undefined;
  provider: string;
  currentDefaultModel?: string;
  currentTopicClusteringModel?: string;
  currentEmbeddingsModel?: string;
  onDefaultModelsUpdated?: (models: {
    defaultModel?: string;
    topicClusteringModel?: string;
    embeddingsModel?: string;
  }) => void;
};

export const AddModelProviderForm = ({
  projectId,
  organizationId,
  provider: initialProvider,
  currentDefaultModel,
  currentTopicClusteringModel,
  currentEmbeddingsModel,
  onDefaultModelsUpdated,
}: AddModelProviderFormProps) => {
  const { closeDrawer } = useDrawer();
  const { project } = useOrganizationTeamProject();

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Create a provider object for new provider
  const provider: MaybeStoredModelProvider = useMemo(() => {
    return {
      provider: initialProvider,
      enabled: false,
      customKeys: null,
      models: null,
      embeddingsModels: null,
      disabledByDefault: true,
      deploymentMapping: null,
      extraHeaders: [],
    };
  }, [initialProvider]);

  // Use project data as primary source (auto-updates when organization.getAll is invalidated)
  // Props are fallback for initial render before project data is available
  const [state, actions] = useModelProviderForm({
    provider,
    projectId,
    projectDefaultModel: project?.defaultModel ?? currentDefaultModel ?? DEFAULT_MODEL,
    projectTopicClusteringModel:
      project?.topicClusteringModel ?? currentTopicClusteringModel ?? DEFAULT_TOPIC_CLUSTERING_MODEL,
    projectEmbeddingsModel:
      project?.embeddingsModel ?? currentEmbeddingsModel ?? DEFAULT_EMBEDDINGS_MODEL,    onSuccess: () => {
      closeDrawer();
    },
    onDefaultModelsUpdated,
  });

  const providerDefinition =
    modelProvidersRegistry[
      provider.provider as keyof typeof modelProvidersRegistry
    ];

  const handleSave = useCallback(() => {
    // Clear previous errors
    setFieldErrors({});
    
    // Validate keys according to schema before submitting
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
    
    void actions.submit();
  }, [providerDefinition, state.customKeys, actions]);

  return (
    <VStack gap={4} align="start" width="full">
      <VStack align="start" width="full" gap={4}>
        {provider.provider === "azure" && (
          <Field.Root>
            <Switch
              onCheckedChange={(details) => {
                actions.setUseApiGateway(details.checked);
              }}
              checked={state.useApiGateway}
            >
              Use API Gateway
            </Switch>
          </Field.Root>
        )}

        <CredentialsSection
          state={state}
          actions={actions}
          provider={provider}
          fieldErrors={fieldErrors}
          setFieldErrors={setFieldErrors}
          projectId={projectId}
          organizationId={organizationId}
        />

        <ExtraHeadersSection
          state={state}
          actions={actions}
          provider={provider}
        />

        <CustomModelInputSection
          state={state}
          actions={actions}
          provider={provider}
        />

        <HStack width="full" justify="end">
          <Button
            size="sm"
            colorPalette="orange"
            loading={state.isSaving}
            onClick={handleSave}
          >
            Save
          </Button>
        </HStack>
      </VStack>
    </VStack>
  );
};

// ============================================================================
// EDIT MODEL PROVIDER FORM
// ============================================================================

type EditModelProviderFormProps = {
  projectId?: string | undefined;
  organizationId?: string | undefined;
  modelProviderId: string;
  currentDefaultModel?: string;
  currentTopicClusteringModel?: string;
  currentEmbeddingsModel?: string;
  onDefaultModelsUpdated?: (models: {
    defaultModel?: string;
    topicClusteringModel?: string;
    embeddingsModel?: string;
  }) => void;
};

export const EditModelProviderForm = ({
  projectId,
  organizationId,
  modelProviderId,
  currentDefaultModel,
  currentTopicClusteringModel,
  currentEmbeddingsModel,
  onDefaultModelsUpdated,
}: EditModelProviderFormProps) => {
  const { providers } = useModelProvidersSettings({
    projectId: projectId,
  });
  const { closeDrawer } = useDrawer();
  const { project } = useOrganizationTeamProject();

  // Count enabled providers to determine if this is the only one
  const enabledProvidersCount = useMemo(() => {
    if (!providers) return 0;
    return Object.values(providers).filter((p) => p.enabled).length;
  }, [providers]);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Get provider from modelProviderId
  const provider: MaybeStoredModelProvider = useMemo(() => {
    if (modelProviderId && providers) {
      const existing = Object.values(providers).find(
        (p) => p.id === modelProviderId,
      );
      if (existing) return existing;
    }

    // Fallback for edge cases
    return {
      provider: "custom",
      enabled: false,
      customKeys: null,
      models: null,
      embeddingsModels: null,
      disabledByDefault: true,
      deploymentMapping: null,
      extraHeaders: [],
    };
  }, [modelProviderId, providers]);

  // Use project data as primary source (auto-updates when organization.getAll is invalidated)
  // Props are fallback for initial render before project data is available
  const [state, actions] = useModelProviderForm({
    provider,
    projectId,
    projectDefaultModel: project?.defaultModel ?? currentDefaultModel ?? DEFAULT_MODEL,
    projectTopicClusteringModel:
      project?.topicClusteringModel ?? currentTopicClusteringModel ?? DEFAULT_TOPIC_CLUSTERING_MODEL,
    projectEmbeddingsModel:
      project?.embeddingsModel ?? currentEmbeddingsModel ?? DEFAULT_EMBEDDINGS_MODEL,
    onSuccess: () => {
      closeDrawer();
    },
    onDefaultModelsUpdated,
  });

  const providerDefinition =
    modelProvidersRegistry[
      provider.provider as keyof typeof modelProvidersRegistry
    ];

  const handleSave = useCallback(() => {
    // Clear previous errors
    setFieldErrors({});
    
    // Validate keys according to schema before submitting
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
    
    void actions.submit();
  }, [providerDefinition, state.customKeys, actions]);

  return (
    <VStack gap={4} align="start" width="full">
      <VStack align="start" width="full" gap={4}>
        {provider.provider === "azure" && (
          <Field.Root>
            <Switch
              onCheckedChange={(details) => {
                actions.setUseApiGateway(details.checked);
              }}
              checked={state.useApiGateway}
            >
              Use API Gateway
            </Switch>
          </Field.Root>
        )}

        <CredentialsSection
          state={state}
          actions={actions}
          provider={provider}
          fieldErrors={fieldErrors}
          setFieldErrors={setFieldErrors}
          projectId={projectId}
          organizationId={organizationId}
        />

        <ExtraHeadersSection
          state={state}
          actions={actions}
          provider={provider}
        />

        <CustomModelInputSection
          state={state}
          actions={actions}
          provider={provider}
        />

        <DefaultProviderSection
          state={state}
          actions={actions}
          provider={provider}
          enabledProvidersCount={enabledProvidersCount}
          project={project}
        />

        <HStack width="full" justify="end">
          <Button
            size="sm"
            colorPalette="orange"
            loading={state.isSaving}
            onClick={handleSave}
          >
            Save
          </Button>
        </HStack>
      </VStack>
    </VStack>
  );
};
