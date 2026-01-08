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
import { Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import { useModelProvidersSettings } from "../../hooks/useModelProvidersSettings";
import {
  useModelProviderForm,
  type UseModelProviderFormState,
  type UseModelProviderFormActions,
  type ExtraHeader,
} from "../../hooks/useModelProviderForm";
import { useModelProviderApiKeyValidation } from "../../hooks/useModelProviderApiKeyValidation";
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
import { Tooltip } from "../ui/tooltip";
import { modelProviderIcons } from "../../server/modelProviders/iconsMap";
import { Select } from "../ui/select";
import { InputGroup } from "../ui/input-group";
import { Search } from "react-feather";
import { createListCollection } from "@chakra-ui/react";
import { isProviderUsedForDefaultModels } from "../../utils/modelProviderHelpers";

/**
 * A simple model selector for a specific provider.
 * Shows only the models passed in options without fetching from API.
 * Used in the model provider settings form to select default models.
 */
const ProviderModelSelector = React.memo(function ProviderModelSelector({
  model,
  options,
  onChange,
  providerKey,
  size = "full",
}: {
  model: string;
  options: string[];
  onChange: (model: string) => void;
  providerKey: string;
  size?: "sm" | "md" | "full";
}) {
  const [modelSearch, setModelSearch] = useState("");

  const providerIcon = modelProviderIcons[providerKey as keyof typeof modelProviderIcons];

  // Create model options with labels (model name without provider prefix)
  const selectOptions = useMemo(() => 
    options.map((modelValue) => ({
      label: modelValue.split("/").slice(1).join("/"),
      value: modelValue,
      icon: providerIcon,
    })),
    [options, providerIcon]
  );

  // Filter models by search
  const filteredModels = useMemo(() => 
    selectOptions.filter(
      (item) =>
        item.label.toLowerCase().includes(modelSearch.toLowerCase()) ||
        item.value.toLowerCase().includes(modelSearch.toLowerCase())
    ),
    [selectOptions, modelSearch]
  );

  const modelCollection = createListCollection({
    items: filteredModels,
  });

  const selectedItem = selectOptions.find((option) => option.value === model);

  const selectValueText = (
    <HStack overflow="hidden" gap={2} align="center">
      {providerIcon && (
        <Box minWidth="16px">
          {providerIcon}
        </Box>
      )}
      <Box
        fontSize={14}
        fontFamily="mono"
        lineClamp={1}
        wordBreak="break-all"
      >
        {selectedItem?.label ?? model.split("/").slice(1).join("/")}
      </Box>
    </HStack>
  );

  const [highlightedValue, setHighlightedValue] = useState<string | null>(model);

  useEffect(() => {
    const highlightedItem = modelCollection.items.find(
      (item) => item.value === highlightedValue
    );
    if (!highlightedItem) {
      setHighlightedValue(modelCollection.items[0]?.value ?? null);
    }
  }, [highlightedValue, modelCollection.items]);

  return (
    <Select.Root
      collection={modelCollection}
      value={[model]}
      onChange={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onValueChange={(change) => {
        const selectedValue = change.value[0];
        if (selectedValue) {
          onChange(selectedValue);
        }
      }}
      loopFocus={true}
      highlightedValue={highlightedValue}
      onHighlightChange={(details) => {
        setHighlightedValue(details.highlightedValue);
      }}
      size={size === "full" ? undefined : size}
    >
      <Select.Trigger
        className="fix-hidden-inputs"
        width={size === "full" ? "100%" : "auto"}
        background="white"
        padding={0}
      >
        <Select.ValueText
          // @ts-ignore
          placeholder={selectValueText}
        >
          {() => selectValueText}
        </Select.ValueText>
      </Select.Trigger>
      <Select.Content zIndex="1600">
        <Field.Root asChild>
          <Box position="sticky" top={0} zIndex="1">
            <InputGroup
              startElement={<Search size={16} />}
              startOffset="-4px"
              background="white"
              width="calc(100% - 9px)"
            >
              <Input
                size="sm"
                placeholder="Search models"
                type="search"
                value={modelSearch}
                onChange={(e) => setModelSearch(e.target.value)}
              />
            </InputGroup>
          </Box>
        </Field.Root>
        {filteredModels.map((item) => (
          <Select.Item key={item.value} item={item}>
            <HStack gap={2}>
              {providerIcon && (
                <Box width="14px" minWidth="14px">
                  {providerIcon}
                </Box>
              )}
              <Box fontSize={14} fontFamily="mono" paddingY="2px">
                {item.label}
              </Box>
            </HStack>
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
});

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
  apiKeyValidationError,
  onApiKeyValidationClear,
}: {
  state: UseModelProviderFormState;
  actions: UseModelProviderFormActions;
  provider: MaybeStoredModelProvider;
  fieldErrors: Record<string, string>;
  setFieldErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  projectId?: string;
  organizationId?: string;
  apiKeyValidationError?: string;
  onApiKeyValidationClear?: () => void;
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
          // Check if field is optional using Zod's public API
          const zodSchema = state.displayKeys[key];
          const isOptional = zodSchema?.isOptional?.() ?? false;
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
                    // Clear API key validation error when user modifies the field
                    if (onApiKeyValidationClear && apiKeyValidationError) {
                      onApiKeyValidationClear();
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
      {apiKeyValidationError && (
        <Field.Root invalid>
          <Field.ErrorText>{apiKeyValidationError}</Field.ErrorText>
        </Field.Root>
      )}
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
        Use this option for LiteLLM proxy, self-hosted vLLM or any other model providers that support the /chat/completions endpoint.
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
              
              // When toggling ON, sync the model states to this provider's models
              // if the current state values don't belong to this provider
              // Only set if there are options available, otherwise allow custom input
              if (details.checked) {
                if (!state.projectDefaultModel?.startsWith(`${provider.provider}/`) && chatOptions.length > 0) {
                  actions.setProjectDefaultModel(chatOptions[0] ?? null);
                }
                if (!state.projectTopicClusteringModel?.startsWith(`${provider.provider}/`) && chatOptions.length > 0) {
                  actions.setProjectTopicClusteringModel(chatOptions[0] ?? null);
                }
                if (!state.projectEmbeddingsModel?.startsWith(`${provider.provider}/`) && embeddingOptions.length > 0) {
                  actions.setProjectEmbeddingsModel(embeddingOptions[0] ?? null);
                }
              }
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
          <Field.Root width="full">
            <SmallLabel>Default Model</SmallLabel>
            <Text fontSize="xs" color="gray.500" marginBottom={2}>
              For general tasks within LangWatch
            </Text>
            <ProviderModelSelector
              model={
                state.projectDefaultModel?.startsWith(`${provider.provider}/`)
                  ? state.projectDefaultModel
                  : (chatOptions[0] ?? "")
              }
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
                state.projectTopicClusteringModel?.startsWith(`${provider.provider}/`)
                  ? state.projectTopicClusteringModel
                  : (chatOptions[0] ?? "")
              }
              options={chatOptions}
              onChange={(model) =>
                actions.setProjectTopicClusteringModel(model)
              }
              providerKey={provider.provider}
            />
          </Field.Root>

          <Field.Root width="full">
            <SmallLabel>Embeddings Model</SmallLabel>
            <Text fontSize="xs" color="gray.500" marginBottom={2}>
              For embeddings to be used in topic clustering and evaluations
            </Text>
            <ProviderModelSelector
              model={
                state.projectEmbeddingsModel?.startsWith(`${provider.provider}/`)
                  ? state.projectEmbeddingsModel
                  : (embeddingOptions[0] ?? "")
              }
              options={embeddingOptions}
              onChange={(model) => actions.setProjectEmbeddingsModel(model)}
              providerKey={provider.provider}
            />
          </Field.Root>
        </VStack>
      )}
    </VStack>
  );
};



type EditModelProviderFormProps = {
  projectId?: string | undefined;
  organizationId?: string | undefined;
  modelProviderId: string;
};

export const EditModelProviderForm = ({
  projectId,
  organizationId,
  modelProviderId,
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
  const [state, actions] = useModelProviderForm({
    provider,
    projectId,
    projectDefaultModel: project?.defaultModel ?? DEFAULT_MODEL,
    projectTopicClusteringModel: project?.topicClusteringModel ?? DEFAULT_TOPIC_CLUSTERING_MODEL,
    projectEmbeddingsModel: project?.embeddingsModel ?? DEFAULT_EMBEDDINGS_MODEL,
    onSuccess: () => {
      closeDrawer();
    },
  });

  const providerDefinition =
    modelProvidersRegistry[
      provider.provider as keyof typeof modelProvidersRegistry
    ];

  const { validate: validateApiKey, isValidating: isValidatingApiKey, validationError: apiKeyValidationError, clearError: clearApiKeyError } = useModelProviderApiKeyValidation(
    provider.provider,
    state.customKeys,
  );

  const handleSave = useCallback(async () => {
    // Clear previous errors
    setFieldErrors({});
    clearApiKeyError();
    
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

    // Validate API key if provider supports it
    const isValid = await validateApiKey();
    if (!isValid) {
      // Validation error is already set in the hook
      return;
    }
    
    void actions.submit();
  }, [providerDefinition, state.customKeys, actions, validateApiKey, clearApiKeyError]);

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
          apiKeyValidationError={apiKeyValidationError}
          onApiKeyValidationClear={clearApiKeyError}
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
            loading={state.isSaving || isValidatingApiKey}
            onClick={handleSave}
          >
            Save
          </Button>
        </HStack>
      </VStack>
    </VStack>
  );
};
