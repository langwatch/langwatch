import React, {
  useMemo,
  useState,
  useCallback,
  useEffect,
  useId,
  useRef,
} from "react";
import {
  VStack,
  HStack,
  Grid,
  GridItem,
  Button,
  Text,
  Field,
  TagsInput,
  Spinner,
  IconButton,
  Combobox,
  useCombobox,
  useFilter,
  useListCollection,
  useTagsInput,
  NativeSelect,
} from "@chakra-ui/react";
import { z } from "zod";
import { Switch } from "../../../../../components/ui/switch";
import { Tooltip } from "../../../../../components/ui/tooltip";
import { getModelProvider } from "../../../regions/model-providers/registry";
import type { ModelProviderKey } from "../../../regions/model-providers/types";
import { useOrganizationTeamProject } from "../../../../../hooks/useOrganizationTeamProject";
import { useModelProvidersSettings } from "../../../../../hooks/useModelProvidersSettings";
import {
  useModelProviderForm,
  type ExtraHeader,
} from "../../../../../hooks/useModelProviderForm";
import {
  useModelProviderFields,
  type DerivedFieldMeta,
} from "../../../../../hooks/useModelProviderFields";
import { InputWithPrefix } from "../shared/InputWithPrefix";
import { DocsLinks } from "../observability/DocsLinks";
import { Plus, Trash2, Info } from "lucide-react";
import { modelProviders as modelProvidersRegistry } from "../../../../../server/modelProviders/registry";
import {
  parseZodFieldErrors,
  type ZodErrorStructure,
} from "../../../../../utils/zod";

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

  const inputId = useId();
  const controlRef = useRef<HTMLDivElement | null>(null);

  const customModelValues = useMemo(
    () => (state.customModels ?? []).map((model) => model.value),
    [state.customModels],
  );

  useEffect(() => {
    if (
      state.defaultModel &&
      !customModelValues.includes(state.defaultModel)
    ) {
      actions.setDefaultModel(null);
    }
  }, [customModelValues, state.defaultModel, actions]);

  const allChatModelItems = useMemo(() => {
    const existing = new Set<string>();
    (state.chatModelOptions ?? []).forEach((option) => {
      if (option?.value) existing.add(option.value);
    });
    customModelValues.forEach((value) => {
      if (value) existing.add(value);
    });
    return Array.from(existing);
  }, [state.chatModelOptions, customModelValues]);

  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { contains } = useFilter({ sensitivity: "base" });
  const { collection, filter } = useListCollection({
    initialItems: allChatModelItems,
    filter: contains,
  });

  useEffect(() => {
    if (collection.setItems) {
      collection.setItems(allChatModelItems);
    }
  }, [collection, allChatModelItems]);

  const handleTagsValueChange = useCallback(
    (details: { value: string[] }) => {
      actions.setCustomModels(
        details.value.map((value) => ({ label: value, value })),
      );
    },
    [actions],
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
    [filter],
  );

  const handleComboboxValueChange = useCallback(
    (event: { value?: string[] }) => {
      const nextValue = event.value?.[0];
      if (!nextValue) return;
      if (!customModelValues.includes(nextValue)) {
        tags.addValue(nextValue);
      }
    },
    [customModelValues, tags],
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

  const validateOpenAi = useCallback(() => {
    if (backendKey !== "openai") return true;

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
    if (
      baseUrl === OPENAI_DEFAULT_BASE_URL &&
      !apiKey
    ) {
      setOpenAiValidationError(
        "API Key is required when using the default OpenAI base URL",
      );
      return false;
    }

    setOpenAiValidationError(undefined);
    return true;
  }, [backendKey, state.customKeys]);

  const handleSaveAndContinue = useCallback(() => {
    if (!validateOpenAi()) {
      return;
    }

    // Clear previous errors
    setFieldErrors({});
    setOpenAiValidationError(undefined);

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
  }, [validateOpenAi, actions, backendKey, state.customKeys]);

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
          Enter your API credentials and allowlisted models for {meta.label}.
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
          {/* Credentials fields derived from schema/displayKeys */}
          <VStack align="stretch">
            <VStack align="stretch" gap={3}>
              {Object.keys(state.displayKeys ?? {}).map((key) => {
                const metaField = derivedFields.find(
                  (f: DerivedFieldMeta) => f.key === key,
                );
                const fieldMetadata = meta.fieldMetadata?.[key];

                const isPassword = metaField?.type === "password";
                const required = metaField?.required ?? false;
                const fieldLabel = fieldMetadata?.label ?? key;
                const fieldDescription = fieldMetadata?.description;

                return (
                  <Field.Root
                    key={key}
                    required={required}
                    invalid={
                      !!fieldErrors[key] ||
                      (key === Object.keys(state.displayKeys ?? {})[0] && !!openAiValidationError)
                    }
                  >
                    <HStack gap={1} align="center">
                      <Field.Label>
                        {fieldLabel}
                        {required && <Field.RequiredIndicator />}
                      </Field.Label>
                      {fieldDescription && (
                        <Tooltip
                          content={fieldDescription}
                          positioning={{ placement: "top" }}
                          showArrow
                        >
                          <IconButton
                            aria-label={`Info about ${fieldLabel}`}
                            variant="ghost"
                            size="2xs"
                            colorPalette="gray"
                          >
                            <Info />
                          </IconButton>
                        </Tooltip>
                      )}
                    </HStack>
                    <InputWithPrefix
                      prefix={`${key}=`}
                      placeholder={metaField?.placeholder}
                      autoComplete="off"
                      value={state.customKeys[key] ?? ""}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        actions.setCustomKey(key, e.target.value);
                        // Clear field-specific error when user types
                        if (fieldErrors[key]) {
                          setFieldErrors(prev => {
                            const updated = { ...prev };
                            delete updated[key];
                            return updated;
                          });
                        }
                        // Clear OpenAI validation error when user types
                        if (backendKey === "openai" && openAiValidationError) {
                          setOpenAiValidationError(undefined);
                        }
                      }}
                      showVisibilityToggle={isPassword}
                      ariaLabel={key}
                      invalid={!!fieldErrors[key]}
                    />
                    {fieldErrors[key] && (
                      <Field.ErrorText>{fieldErrors[key]}</Field.ErrorText>
                    )}
                  </Field.Root>
                );
              })}
            </VStack>
            {/* Show OpenAI validation error below all fields */}
            {backendKey === "openai" && openAiValidationError && (
                <Field.Root invalid>
                  <Field.ErrorText>{openAiValidationError}</Field.ErrorText>
                </Field.Root>
              )}
          </VStack>

          {/* Extra headers for Azure and Custom */}
          {(backendKey === "azure" || backendKey === "custom") && (
            <VStack align="stretch" gap={2}>
              <Text fontSize="sm" color="fg.muted">
                Extra Headers
              </Text>
              <Grid templateColumns="auto auto" gap={3} rowGap={2}>
                {state.extraHeaders.map((h: ExtraHeader, index: number) => (
                  <React.Fragment key={index}>
                    <GridItem>
                      <InputWithPrefix
                        placeholder="Header name"
                        value={h.key}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          actions.setExtraHeaderKey(index, e.target.value)
                        }
                        ariaLabel="Header name"
                      />
                    </GridItem>
                    <GridItem>
                      <HStack gap={1}>
                        <InputWithPrefix
                          placeholder="Header value"
                          value={h.value}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            actions.setExtraHeaderValue(index, e.target.value)
                          }
                          showVisibilityToggle={true}
                          ariaLabel="Header value"
                        />
                        <IconButton
                          size="sm"
                          variant="ghost"
                          colorPalette="red"
                          onClick={() => actions.removeExtraHeader(index)}
                        >
                          <Trash2 />
                        </IconButton>
                      </HStack>
                    </GridItem>
                  </React.Fragment>
                ))}
              </Grid>
              <HStack justify="end">
                <Button
                  size="xs"
                  variant="surface"
                  bg={"bg.subtle/10"}
                  backdropBlur={"md"}
                  w="full"
                  onClick={() => actions.addExtraHeader()}
                >
                  <Plus /> Add Header
                </Button>
              </HStack>
            </VStack>
          )}

          {/* Chat models */}
          <Field.Root>
            <Combobox.RootProvider value={combobox}>
              <TagsInput.RootProvider value={tags} variant={"flushed"} size="sm">
                <TagsInput.Label>Allowed Chat Models</TagsInput.Label>
                <TagsInput.Control ref={controlRef}>
                  {tags.value.map((tag, index) => (
                    <TagsInput.Item key={index} index={index} value={tag}>
                      <TagsInput.ItemPreview
                        bg="bg.subtle/60"
                        border="border.subtle"
                        borderRadius="md"
                      >
                        <TagsInput.ItemText>{tag}</TagsInput.ItemText>
                        <TagsInput.ItemDeleteTrigger />
                      </TagsInput.ItemPreview>
                      <TagsInput.ItemInput />
                    </TagsInput.Item>
                  ))}
                  <Combobox.Input unstyled asChild>
                    <TagsInput.Input placeholder="Add custom chat model..." />
                  </Combobox.Input>
                </TagsInput.Control>
                <Field.HelperText>
                  Pre-populated with known models. Remove or add as needed. You
                  can update this later in the model provider settings.
                </Field.HelperText>
                <TagsInput.HiddenInput />
                <Combobox.Positioner>
                  <Combobox.Content bg="bg.muted/40" backdropFilter="blur(10px)" borderRadius="md">
                    <Combobox.Empty>No chat models found</Combobox.Empty>
                    {(collection.items as string[] | undefined)
                      ?.filter((item) => !tags.value.includes(item))
                      .map((item) => (
                        <Combobox.Item
                          item={item}
                          key={item}
                          borderRadius="md"
                          bg="none"
                          _hover={{
                            bg: "bg.subtle/30",
                          }}
                        >
                          <Combobox.ItemText>{item}</Combobox.ItemText>
                          <Combobox.ItemIndicator />
                        </Combobox.Item>
                      ))}
                  </Combobox.Content>
                </Combobox.Positioner>
              </TagsInput.RootProvider>
            </Combobox.RootProvider>
          </Field.Root>

          {/* Default chat model */}
          <Field.Root>
            <Field.Label>Default Chat Model</Field.Label>
            <NativeSelect.Root size="sm" bg="bg.muted/40">
              <NativeSelect.Field
                value={state.defaultModel ?? ""}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  actions.setDefaultModel(e.target.value || null)
                }
              >
                <option value="">Select default model...</option>
                {customModelValues.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
            <Field.HelperText>
              This model will be used for evaluations, prompt optimization, and
              dataset generation. Change this anytime in the model provider settings.
            </Field.HelperText>
          </Field.Root>

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
