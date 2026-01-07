import {
  VStack,
  HStack,
  Button,
  Field,
  Grid,
  GridItem,
  Input,
  Text,
  Box,
  Combobox,
  TagsInput,
  useCombobox,
  useFilter,
  useListCollection,
  useTagsInput,
} from "@chakra-ui/react";
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Plus, Trash2 } from "react-feather";
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
import { Tooltip } from "../ui/tooltip";
import { isProviderUsedForDefaultModels } from "../../utils/modelProviderHelpers";


/**
 * A creatable dropdown selector for default model selection.
 * Uses native Chakra Combobox to allow users to select existing models or create custom model names.
 * Shows model names without provider prefix and automatically adds the provider prefix to created models.
 * @param model - The currently selected model (in format "provider/model-name")
 * @param options - Array of available model options for this provider (in format "provider/model-name")
 * @param onChange - Callback when a model is selected or created
 * @param providerKey - The provider identifier (e.g., "openai", "anthropic")
 * @param placeholder - Optional placeholder text for the input
 */
const CreatableModelSelector = ({
  model,
  options,
  onChange,
  providerKey,
  placeholder = "Select or type a model name",
}: {
  model: string;
  options: string[];
  onChange: (model: string) => void;
  providerKey: string;
  placeholder?: string;
}) => {
  const inputId = useId();
  const providerIcon = modelProviderIcons[providerKey as keyof typeof modelProviderIcons];

  // Convert options to display format (model name without prefix)
  const displayOptions = useMemo(() => 
    options.map((option) => option.split("/").slice(1).join("/")),
    [options]
  );

  // Get current display value (model name without prefix)
  const currentDisplayValue = useMemo(() => 
    model ? model.split("/").slice(1).join("/") : "",
    [model]
  );

  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { contains } = useFilter({ sensitivity: "base" });
  const { collection, filter } = useListCollection({
    initialItems: displayOptions,
    filter: contains,
  });

  const handleInputChange = useCallback(
    (event: { inputValue: string }) => {
      filter(event.inputValue);
    },
    [filter]
  );

  const handleValueChange = useCallback(
    (event: { value?: string[]; inputValue?: string }) => {
      const selected = event.value?.[0];
      if (selected) {
        // Convert display value back to full "provider/model-name" format
        const fullValue = selected.includes("/") ? selected : `${providerKey}/${selected}`;
        onChange(fullValue);
      }
    },
    [onChange, providerKey]
  );

  const combobox = useCombobox({
    ids: { input: inputId },
    collection,
    allowCustomValue: true,
    value: currentDisplayValue ? [currentDisplayValue] : [],
    inputValue: currentDisplayValue,
    onInputValueChange: handleInputChange,
    onValueChange: handleValueChange,
  });

  return (
    <Box width="full">
      <Combobox.RootProvider value={combobox}>
        <Combobox.Control>
          <HStack  gap={1} >
            <Combobox.Input 
              placeholder={placeholder} 
              fontSize="sm" 
              fontFamily="mono"
            />
          </HStack>
          <Combobox.ClearTrigger />
        </Combobox.Control>
        <Combobox.Positioner>
          <Combobox.Content borderRadius="md">
            <Combobox.Empty>
              <Text fontSize="sm" color="gray.500">
                Type to create a new model
              </Text>
            </Combobox.Empty>
            {(collection.items as string[]).map((item) => (
              <Combobox.Item key={item} item={item} borderRadius="md">
                <HStack gap={2}>
                  {providerIcon && <Box boxSize={3.5} display="flex" alignItems="center">{providerIcon}</Box>}
                  <Combobox.ItemText fontSize="sm" fontFamily="mono">
                    {item}
                  </Combobox.ItemText>
                </HStack>
                <Combobox.ItemIndicator />
              </Combobox.Item>
            ))}
          </Combobox.Content>
        </Combobox.Positioner>
      </Combobox.RootProvider>
    </Box>
  );
};

/**
 * Renders credential input fields (API keys, endpoints, etc.) based on the provider's schema.
 * For managed providers (enterprise deployments), displays a managed provider component instead of input fields.
 * Handles field validation, password masking, and optional field indicators.
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
  const inputId = useId();
  const controlRef = useRef<HTMLDivElement | null>(null);

  const customModelValues = useMemo(
    () => state.customModels.map((m) => m.value),
    [state.customModels]
  );

  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { contains } = useFilter({ sensitivity: "base" });
  const { collection, filter } = useListCollection({
    initialItems: [] as string[],
    filter: contains,
  });

  const handleTagsValueChange = useCallback(
    (details: { value: string[] }) => {
      actions.setCustomModels(
        details.value.map((value) => ({ label: value, value }))
      );
    },
    [actions]
  );

  const tags = useTagsInput({
    ids: { input: inputId },
    value: customModelValues,
    onValueChange: handleTagsValueChange,
  });

  useEffect(() => {
    const differs =
      tags.value.length !== customModelValues.length ||
      tags.value.some((value, index) => value !== customModelValues[index]);
    if (differs) {
      tags.setValue(customModelValues);
    }
  }, [customModelValues, tags]);

  const handleComboboxInputChange = useCallback(
    (event: { inputValue: string }) => {
      filter(event.inputValue);
    },
    [filter]
  );

  const handleComboboxValueChange = useCallback(
    (event: { value?: string[] }) => {
      const nextValue = event.value?.[0];
      if (!nextValue) return;
      if (!customModelValues.includes(nextValue)) {
        tags.addValue(nextValue);
      }
    },
    [customModelValues, tags]
  );

  const combobox = useCombobox({
    ids: { input: inputId },
    collection,
    allowCustomValue: true,
    value: [],
    selectionBehavior: "clear",
    positioning: {
      getAnchorRect: () => controlRef.current?.getBoundingClientRect() ?? null,
    },
    onInputValueChange: handleComboboxInputChange,
    onValueChange: handleComboboxValueChange,
  });

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
        <Field.Root>
          <Combobox.RootProvider value={combobox}>
            <TagsInput.RootProvider value={tags} size="sm">
              <TagsInput.Control ref={controlRef}>
                {tags.value.map((tag, index) => (
                  <TagsInput.Item key={index} index={index} value={tag}>
                    <TagsInput.ItemPreview
                      borderRadius="md"
                    >
                      <TagsInput.ItemText>{tag}</TagsInput.ItemText>
                      <TagsInput.ItemDeleteTrigger />
                    </TagsInput.ItemPreview>
                    <TagsInput.ItemInput />
                  </TagsInput.Item>
                ))}
                <Combobox.Input unstyled asChild>
                  <TagsInput.Input placeholder="Add custom model" />
                </Combobox.Input>
              </TagsInput.Control>
              <TagsInput.HiddenInput />
              <Combobox.Positioner>
                <Combobox.Content borderRadius="md">
                  <Combobox.Empty>
                    <Text fontSize="sm" color="gray.500">
                      Type to add a model
                    </Text>
                  </Combobox.Empty>
                </Combobox.Content>
              </Combobox.Positioner>
            </TagsInput.RootProvider>
          </Combobox.RootProvider>
        </Field.Root>
      </Box>
    </VStack>
  );
};

/**
 * Renders the "Use as default provider" toggle and default model selection fields.
 * When enabled, allows selection of default models for chat, topic clustering, and embeddings.
 * The toggle is disabled if the provider is currently in use or is the only enabled provider.
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
        >
          {chatOptions.length > 0 ? (
            <>
              <Field.Root width="full">
                <SmallLabel>Default Model</SmallLabel>
                <Text fontSize="xs" color="gray.500" marginBottom={2}>
                  For general tasks within LangWatch
                </Text>
                <CreatableModelSelector
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
                <CreatableModelSelector
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
              <CreatableModelSelector
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
