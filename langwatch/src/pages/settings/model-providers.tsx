import {
  Alert,
  Box,
  Button,
  Card,
  Field,
  Grid,
  GridItem,
  Heading,
  HStack,
  Input,
  Skeleton,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Trash2, Plus } from "react-feather";
import { zodResolver } from "@hookform/resolvers/zod";
import React, { useCallback, useState, useEffect, useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { ProjectSelector } from "../../components/DashboardLayout";
import { HorizontalFormControl } from "../../components/HorizontalFormControl";
import {
  ModelSelector,
  modelSelectorOptions,
} from "../../components/ModelSelector";
import SettingsLayout from "../../components/SettingsLayout";
import { SmallLabel } from "../../components/SmallLabel";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { modelProviderIcons } from "../../server/modelProviders/iconsMap";
import {
  getProviderModelOptions,
  modelProviders as modelProvidersRegistry,
  type MaybeStoredModelProvider,
} from "../../server/modelProviders/registry";
import { api } from "../../utils/api";

import CreatableSelect from "react-select/creatable";
import { Switch } from "../../components/ui/switch";
import { toaster } from "../../components/ui/toaster";
import {
  DEFAULT_EMBEDDINGS_MODEL,
  DEFAULT_TOPIC_CLUSTERING_MODEL,
  DEFAULT_MODEL,
  KEY_CHECK,
} from "../../utils/constants";
import { dependencies } from "../../injection/dependencies.client";
import { PermissionAlert } from "../../components/PermissionAlert";

/**
 * Handles creating multiple options from comma-separated input
 * Single Responsibility: Split comma-separated text and add as multiple options
 */
const handleCreateMultipleOptions = (
  newValue: string,
  currentValue: { label: string; value: string }[],
  onChange: (value: { label: string; value: string }[]) => void,
) => {
  // Split on comma and create multiple options
  const tokens = newValue
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const existing = new Set(currentValue.map((v) => v.value));
  const toAdd = tokens
    .filter((t) => !existing.has(t))
    .map((t) => ({ label: t, value: t }));

  if (toAdd.length > 0) {
    onChange([...currentValue, ...toAdd]);
  }
};

export default function ModelsPage() {
  const { project, organizations, hasPermission } =
    useOrganizationTeamProject();
  const hasModelProvidersManagePermission = hasPermission("project:manage");

  const modelProviders = api.modelProvider.getAllForProjectForFrontend.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );
  const updateMutation = api.modelProvider.update.useMutation();

  return (
    <SettingsLayout>
      <VStack
        gap={6}
        width="full"
        maxWidth="920px"
        align="start"
        paddingY={6}
        paddingBottom={12}
        paddingX={4}
      >
        <HStack width="full" marginTop={6}>
          <Heading size="lg" as="h1">
            Model Providers
          </Heading>

          <Spacer />
          {updateMutation.isLoading && <Spinner />}
          {organizations && project && (
            <ProjectSelector organizations={organizations} project={project} />
          )}
        </HStack>
        <Text>
          Define which models are allowed to be used on LangWatch for this
          project. <br />
          You can also use your own API keys.
        </Text>
        <Card.Root width="full">
          <Card.Body width="full" paddingY={4}>
            <VStack gap={0} width="full">
              {modelProviders.isLoading &&
                Array.from({
                  length: Object.keys(modelProvidersRegistry).length,
                }).map((_, index) => (
                  <Box
                    key={index}
                    width="full"
                    borderBottomWidth="1px"
                    _last={{ border: "none" }}
                    paddingY={6}
                  >
                    <Skeleton width="full" height="28px" />
                  </Box>
                ))}
              {modelProviders.data &&
                hasModelProvidersManagePermission &&
                Object.values(modelProviders.data).map((provider, index) => (
                  <ModelProviderForm
                    key={index}
                    provider={provider}
                    refetch={modelProviders.refetch}
                    updateMutation={updateMutation}
                  />
                ))}
              {!hasModelProvidersManagePermission && (
                <PermissionAlert permission="project:manage" />
              )}
            </VStack>
          </Card.Body>
        </Card.Root>

        <VStack width="full" align="start" gap={6}>
          <VStack gap={2} marginTop={2} align="start" width="full">
            <Heading size="md" as="h2">
              Default Models
            </Heading>
            <Text>
              Configure the default models used on workflows, evaluations and
              other LangWatch features.
            </Text>
          </VStack>
          <Card.Root width="full">
            <Card.Body width="full">
              <VStack gap={0} width="full" align="stretch">
                {!hasModelProvidersManagePermission ? (
                  <PermissionAlert permission="project:manage" />
                ) : (
                  <>
                    <DefaultModel />
                    <TopicClusteringModel />
                    <EmbeddingsModel />
                  </>
                )}
              </VStack>
            </Card.Body>
          </Card.Root>
        </VStack>
      </VStack>
    </SettingsLayout>
  );
}

type ModelProviderForm = {
  id?: string;
  provider: string;
  enabled: boolean;
  customKeys?: Record<string, unknown> | null;
  customModels?: { value: string; label: string }[] | null;
  customEmbeddingsModels?: { value: string; label: string }[] | null;
};

type CustomHeader = {
  id: string;
  key: string;
  value: string;
};

function ModelProviderForm({
  provider,
  refetch,
  updateMutation,
}: {
  provider: MaybeStoredModelProvider;
  refetch: () => Promise<any>;
  updateMutation: ReturnType<typeof api.modelProvider.update.useMutation>;
}) {
  const { project, organization } = useOrganizationTeamProject();

  // State for Azure API Gateway toggle
  const [useApiGateway, setUseApiGateway] = useState(() => {
    if (provider.provider === "azure" && provider.customKeys) {
      return !!(provider.customKeys as any).AZURE_API_GATEWAY_BASE_URL;
    }
    return false;
  });

  // State for custom headers
  const [customHeaders, setCustomHeaders] = useState<CustomHeader[]>(() => {
    if (provider.provider === "azure" && provider.customKeys) {
      const headers: CustomHeader[] = [];
      const keys = provider.customKeys as Record<string, unknown>;

      // Extract custom headers (keys that are not standard Azure keys)
      const standardAzureKeys = new Set([
        "AZURE_OPENAI_API_KEY",
        "AZURE_OPENAI_ENDPOINT",
        "AZURE_API_GATEWAY_BASE_URL",
        "AZURE_API_GATEWAY_VERSION",
      ]);

      Object.entries(keys).forEach(([key, value]) => {
        if (!standardAzureKeys.has(key) && typeof value === "string") {
          headers.push({
            id: `header_${Date.now()}_${key}`, // Generate unique ID
            key: key,
            value: value,
          });
        }
      });

      return headers;
    }
    return [];
  });

  const localUpdateMutation = api.modelProvider.update.useMutation();

  // Functions to handle custom headers
  const addCustomHeader = useCallback(() => {
    const newHeader: CustomHeader = {
      id: `header_${Date.now()}`,
      key: customHeaders.length === 0 ? "api-key" : "",
      value: "",
    };
    setCustomHeaders((prev) => [...prev, newHeader]);
  }, [customHeaders.length]);

  const removeCustomHeader = useCallback((id: string) => {
    setCustomHeaders((prev) => prev.filter((header) => header.id !== id));
  }, []);

  const updateCustomHeader = useCallback(
    (id: string, field: "key" | "value", value: string) => {
      setCustomHeaders((prev) =>
        prev.map((header) => {
          if (header.id === id) {
            return { ...header, [field]: value };
          }
          return header;
        }),
      );
    },
    [],
  );

  const providerDefinition =
    modelProvidersRegistry[
      provider.provider as keyof typeof modelProvidersRegistry
    ];

  // Get filtered keys based on API Gateway toggle for Azure
  const getFilteredKeys = useCallback(
    (keys: Record<string, unknown>) => {
      if (provider.provider === "azure") {
        const baseKeys = useApiGateway
          ? {
              // Show only API Gateway keys
              AZURE_API_GATEWAY_BASE_URL: keys.AZURE_API_GATEWAY_BASE_URL || "",
              AZURE_API_GATEWAY_VERSION: keys.AZURE_API_GATEWAY_VERSION || "",
            }
          : {
              // Show only regular Azure OpenAI keys
              AZURE_OPENAI_API_KEY: keys.AZURE_OPENAI_API_KEY || "",
              AZURE_OPENAI_ENDPOINT: keys.AZURE_OPENAI_ENDPOINT || "",
            };

        // Add custom headers
        const customHeaderKeys: Record<string, string> = {};
        customHeaders.forEach((header) => {
          if (header.key.trim() && header.value.trim()) {
            // Sanitize the key name to ensure it's valid
            const sanitizedKey = header.key
              .trim()
              .replace(/[^a-zA-Z0-9_-]/g, "_");
            if (sanitizedKey) {
              customHeaderKeys[sanitizedKey] = header.value.trim();
            }
          }
        });

        return { ...baseKeys, ...customHeaderKeys };
      }
      return keys;
    },
    [provider.provider, useApiGateway, customHeaders],
  );

  const getStoredModelOptions = (
    models: string[],
    provider: string,
    mode: "chat" | "embedding",
  ) => {
    if (!models || models.length === 0) {
      const options = getProviderModelOptions(provider, mode);
      return options;
    }
    return models.map((model) => ({
      value: model,
      label: model,
    }));
  };

  const form = useForm<ModelProviderForm>({
    defaultValues: {
      id: provider.id,
      provider: provider.provider,
      enabled: provider.enabled,
      customKeys: provider.customKeys
        ? (getFilteredKeys(
            provider.customKeys as Record<string, unknown>,
          ) as Record<string, unknown> | null)
        : null,
      customModels: getStoredModelOptions(
        provider.models ?? [],
        provider.provider,
        "chat",
      ),
      customEmbeddingsModels: getStoredModelOptions(
        provider.embeddingsModels ?? [],
        provider.provider,
        "embedding",
      ),
    },
    resolver: (data, ...args) => {
      const data_ = {
        ...data,
        customKeys: data.customKeys,
        customModels: data.customModels ?? [],
        customEmbeddingsModels: data.customEmbeddingsModels ?? [],
      };

      return zodResolver(
        z.object({
          id: z.string().optional(),
          provider: z.enum(Object.keys(modelProvidersRegistry) as any),
          enabled: z.boolean(),
          customKeys: providerDefinition?.keysSchema
            ? z
                .union([
                  providerDefinition.keysSchema,
                  z.object({ MANAGED: z.string() }),
                ])
                .optional()
                .nullable()
            : z.object({ MANAGED: z.string() }).optional().nullable(),
          customModels: z
            .array(
              z.object({
                value: z.string(),
                label: z.string(),
              }),
            )
            .optional()
            .nullable(),
          customEmbeddingsModels: z
            .array(
              z.object({
                value: z.string(),
                label: z.string(),
              }),
            )
            .optional()
            .nullable(),
        }),
      )(data_, ...args);
    },
  });
  const { register, handleSubmit, formState, watch, setValue, control } = form;

  // Update form when API Gateway toggle or custom headers change
  useEffect(() => {
    if (provider.provider === "azure" && provider.customKeys) {
      const filteredKeys = getFilteredKeys(
        provider.customKeys as Record<string, unknown>,
      );
      setValue("customKeys", filteredKeys as Record<string, unknown> | null);
    }
  }, [
    useApiGateway,
    customHeaders,
    provider.provider,
    provider.customKeys,
    setValue,
    getFilteredKeys,
  ]);

  const onSubmit = useCallback(
    async (data: ModelProviderForm) => {
      // For Azure, build the complete custom keys object
      let customKeys = data.customKeys;
      if (provider.provider === "azure") {
        // Start with the form data (standard Azure keys)
        const baseKeys = data.customKeys || {};

        // Add custom headers from state
        const customHeaderKeys: Record<string, string> = {};
        customHeaders.forEach((header) => {
          if (header.key.trim() && header.value.trim()) {
            const sanitizedKey = header.key
              .trim()
              .replace(/[^a-zA-Z0-9_-]/g, "_");
            if (sanitizedKey) {
              customHeaderKeys[sanitizedKey] = header.value.trim();
            }
          }
        });

        customKeys = { ...baseKeys, ...customHeaderKeys };
      }

      await localUpdateMutation.mutateAsync({
        id: provider.id,
        projectId: project?.id ?? "",
        provider: provider.provider,
        enabled: data.enabled,
        customKeys: customKeys,
        customModels: (data.customModels ?? []).map((m) => m.value),
        customEmbeddingsModels: (data.customEmbeddingsModels ?? []).map(
          (m) => m.value,
        ),
      });
      toaster.create({
        title: "API Keys Updated",
        type: "success",
        duration: 3000,
        meta: {
          closable: true,
        },
      });
      await refetch();
    },
    [
      localUpdateMutation,
      provider.id,
      provider.provider,
      project?.id,
      refetch,
      provider.customKeys,
      customHeaders,
    ],
  );

  const isEnabled = watch("enabled");

  const onEnableDisable = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      setValue("enabled", e.target.checked);
      await updateMutation.mutateAsync({
        id: provider.id,
        projectId: project?.id ?? "",
        provider: provider.provider,
        enabled: e.target.checked,
        customKeys: provider.customKeys as any,
        customModels: provider.models ?? [],
        customEmbeddingsModels: provider.embeddingsModels ?? [],
      });

      await refetch();
    },
    [
      updateMutation,
      provider.id,
      provider.provider,
      provider.customKeys,
      provider.models,
      provider.embeddingsModels,
      project?.id,
      refetch,
      setValue,
    ],
  );

  // Get the original schema shape for validation and placeholder logic
  const getSchemaShape = (schema: any) => {
    if ("shape" in schema) {
      return schema.shape;
    }
    if ("_def" in schema && "schema" in schema._def) {
      return schema._def.schema.shape;
    }
    return {};
  };

  const originalSchemaShape = useMemo(() => {
    return providerDefinition?.keysSchema
      ? getSchemaShape(providerDefinition.keysSchema)
      : {};
  }, [providerDefinition?.keysSchema]);

  // Get filtered keys for form submission (not used in UI rendering)
  const _providerKeys = getFilteredKeys(
    (provider.customKeys as Record<string, unknown>) || {},
  );

  // Get the keys that should be displayed in the UI based on API Gateway toggle
  const getDisplayKeys = useCallback(() => {
    if (provider.provider === "azure") {
      if (useApiGateway) {
        // Show only API Gateway keys
        return {
          AZURE_API_GATEWAY_BASE_URL:
            originalSchemaShape.AZURE_API_GATEWAY_BASE_URL,
          AZURE_API_GATEWAY_VERSION:
            originalSchemaShape.AZURE_API_GATEWAY_VERSION,
        };
      } else {
        // Show only regular Azure OpenAI keys
        return {
          AZURE_OPENAI_API_KEY: originalSchemaShape.AZURE_OPENAI_API_KEY,
          AZURE_OPENAI_ENDPOINT: originalSchemaShape.AZURE_OPENAI_ENDPOINT,
        };
      }
    }
    return originalSchemaShape;
  }, [provider.provider, useApiGateway, originalSchemaShape]);

  const displayKeys = getDisplayKeys();

  const ManagedModelProvider = dependencies.managedModelProviderComponent?.({
    projectId: project?.id ?? "",
    organizationId: organization?.id ?? "",
    provider,
  });

  return (
    <Box
      width="full"
      borderBottomWidth="1px"
      _last={{ border: "none" }}
      paddingY={2}
    >
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={handleSubmit(onSubmit)} style={{ width: "100%" }}>
        <HorizontalFormControl
          label={
            <HStack paddingLeft={0} marginBottom={2}>
              <Box
                width="24px"
                height="24px"
                display="flex"
                alignItems="center"
                justifyContent="center"
              >
                {
                  modelProviderIcons[
                    provider.provider as keyof typeof modelProviderIcons
                  ]
                }
              </Box>
              <Text>{providerDefinition?.name || provider.provider}</Text>
            </HStack>
          }
          helper={(providerDefinition as any)?.blurb ?? ""}
        >
          <VStack align="start" width="full" gap={4} paddingRight={4}>
            <HStack align="start" width="full" gap={4}>
              <HStack gap={6}>
                <Field.Root>
                  <Switch
                    // eslint-disable-next-line @typescript-eslint/no-misused-promises
                    onChange={onEnableDisable}
                    checked={isEnabled}
                  >
                    Enabled
                  </Switch>
                </Field.Root>
              </HStack>
              {provider.provider === "azure" && isEnabled && (
                <Field.Root>
                  <Switch
                    onChange={(e) => setUseApiGateway(e.target.checked)}
                    checked={useApiGateway}
                  >
                    Use API Gateway
                  </Switch>
                </Field.Root>
              )}
            </HStack>

            {isEnabled && (
              <>
                {ManagedModelProvider ? (
                  <ManagedModelProvider provider={provider} form={form} />
                ) : (
                  <Field.Root invalid={!!formState.errors.customKeys}>
                    <Grid
                      templateColumns="auto auto"
                      gap={4}
                      rowGap={2}
                      paddingTop={4}
                      width="full"
                    >
                      <GridItem color="gray.500">
                        <SmallLabel>Key</SmallLabel>
                      </GridItem>
                      <GridItem color="gray.500">
                        <SmallLabel>Value</SmallLabel>
                      </GridItem>
                      {Object.keys(displayKeys).map((key) => (
                        <React.Fragment key={key}>
                          <GridItem
                            alignContent="center"
                            fontFamily="monospace"
                          >
                            {key}
                          </GridItem>
                          <GridItem>
                            <Input
                              {...register(`customKeys.${key}`)}
                              type={
                                KEY_CHECK.some((k) => key.includes(k))
                                  ? "password"
                                  : "text"
                              }
                              autoComplete="off"
                              placeholder={
                                displayKeys[key]?._def?.typeName ===
                                "ZodOptional"
                                  ? "optional"
                                  : undefined
                              }
                            />
                          </GridItem>
                        </React.Fragment>
                      ))}
                    </Grid>
                    <Field.ErrorText>
                      {formState.errors.customKeys?.root?.message}
                    </Field.ErrorText>
                  </Field.Root>
                )}

                {/* Custom Headers Section for Azure */}
                {provider.provider === "azure" && isEnabled && (
                  <VStack width="full" align="start" paddingTop={4}>
                    {customHeaders.length > 0 && (
                      <Grid
                        templateColumns="auto auto auto"
                        gap={4}
                        rowGap={2}
                        width="full"
                      >
                        {customHeaders.map((header) => (
                          <React.Fragment key={header.id}>
                            <GridItem>
                              <Input
                                value={header.key}
                                onChange={(e) =>
                                  updateCustomHeader(
                                    header.id,
                                    "key",
                                    e.target.value,
                                  )
                                }
                                placeholder="Header name"
                                autoComplete="off"
                              />
                            </GridItem>
                            <GridItem>
                              <Input
                                value={header.value}
                                onChange={(e) =>
                                  updateCustomHeader(
                                    header.id,
                                    "value",
                                    e.target.value,
                                  )
                                }
                                placeholder="Header value"
                                autoComplete="off"
                              />
                            </GridItem>
                            <GridItem>
                              <Button
                                size="sm"
                                variant="ghost"
                                colorPalette="red"
                                onClick={() => removeCustomHeader(header.id)}
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
                        onClick={addCustomHeader}
                      >
                        <Plus size={16} />
                        Add Header
                      </Button>
                    </HStack>
                  </VStack>
                )}

                <VStack width="full" gap={4}>
                  <Box width="full" maxWidth="408px">
                    <SmallLabel>Models</SmallLabel>
                    <Controller
                      name="customModels"
                      control={control}
                      render={({ field }) => (
                        <CreatableSelect
                          {...field}
                          onCreateOption={(newValue) => {
                            handleCreateMultipleOptions(
                              newValue,
                              field.value ?? [],
                              field.onChange,
                            );
                          }}
                          isMulti
                          options={getProviderModelOptions(
                            provider.provider,
                            "chat",
                          )}
                          placeholder="Add custom model"
                        />
                      )}
                    />
                  </Box>
                  {(provider.provider === "openai" ||
                    provider.provider === "azure" ||
                    provider.provider === "gemini" ||
                    provider.provider === "bedrock") && (
                    <>
                      <Box width="full">
                        <SmallLabel>Embeddings Models</SmallLabel>
                        <Controller
                          name="customEmbeddingsModels"
                          control={control}
                          render={({ field }) => (
                            <CreatableSelect
                              {...field}
                              onCreateOption={(newValue) => {
                                handleCreateMultipleOptions(
                                  newValue,
                                  field.value ?? [],
                                  field.onChange,
                                );
                              }}
                              isMulti
                              options={getProviderModelOptions(
                                provider.provider,
                                "embedding",
                              )}
                              placeholder="Add custom embeddings model"
                            />
                          )}
                        />
                      </Box>
                    </>
                  )}
                </VStack>

                <HStack width="full">
                  <Spacer />
                  <Button
                    type="submit"
                    size="sm"
                    colorPalette="orange"
                    loading={localUpdateMutation.isLoading}
                  >
                    Save
                  </Button>
                </HStack>
                {provider.provider === "custom" && (
                  <Alert.Root status="info">
                    <Alert.Indicator />
                    <Alert.Content>
                      Custom provider supports only OpenAI compatible endpoints,
                      contact support if you have a custom format.
                    </Alert.Content>
                  </Alert.Root>
                )}
              </>
            )}
          </VStack>
        </HorizontalFormControl>
      </form>
    </Box>
  );
}

type DefaultModelForm = {
  defaultModel: string;
};

function DefaultModel() {
  const { project } = useOrganizationTeamProject();
  const updateDefaultModel = api.project.updateDefaultModel.useMutation();

  const { register, handleSubmit, control } = useForm<DefaultModelForm>({
    defaultValues: {
      defaultModel: project?.defaultModel ?? DEFAULT_MODEL,
    },
  });

  const defaultModelField = register("defaultModel");

  const onUpdateSubmit = useCallback(
    async (data: DefaultModelForm) => {
      await updateDefaultModel.mutateAsync({
        projectId: project?.id ?? "",
        defaultModel: data.defaultModel,
      });
      toaster.create({
        title: "Default Model Updated",
        type: "success",
        duration: 3000,
        meta: {
          closable: true,
        },
      });
    },
    [updateDefaultModel, project?.id],
  );

  return (
    <HorizontalFormControl
      label="Default Model"
      helper="For general tasks within LangWatch"
      paddingY={4}
      borderBottomWidth="1px"
    >
      <HStack>
        <Controller
          name={defaultModelField.name}
          control={control}
          render={({ field }) => (
            <ModelSelector
              model={field.value}
              options={modelSelectorOptions
                .filter((option) => option.mode === "chat")
                .map((option) => option.value)}
              onChange={(model) => {
                field.onChange(model);
                void handleSubmit(onUpdateSubmit)();
              }}
              mode="chat"
            />
          )}
        />
        {updateDefaultModel.isLoading && <Spinner size="sm" marginRight={2} />}
      </HStack>
    </HorizontalFormControl>
  );
}

type TopicClusteringModelForm = {
  topicClusteringModel: string;
};

type EmbeddingsModelForm = {
  embeddingsModel: string;
};

export function TopicClusteringModel() {
  const { project } = useOrganizationTeamProject();
  const updateTopicClusteringModel =
    api.project.updateTopicClusteringModel.useMutation();

  const { register, handleSubmit, control } = useForm<TopicClusteringModelForm>(
    {
      defaultValues: {
        topicClusteringModel:
          project?.topicClusteringModel ?? DEFAULT_TOPIC_CLUSTERING_MODEL,
      },
    },
  );

  const topicClusteringModelField = register("topicClusteringModel");

  const onUpdateSubmit = useCallback(
    async (data: TopicClusteringModelForm) => {
      await updateTopicClusteringModel.mutateAsync({
        projectId: project?.id ?? "",
        topicClusteringModel: data.topicClusteringModel,
      });
      toaster.create({
        title: "Topic Clustering Model Updated",
        type: "success",
        duration: 3000,
        meta: {
          closable: true,
        },
      });
    },
    [updateTopicClusteringModel, project?.id],
  );

  return (
    <HorizontalFormControl
      label="Topic Clustering Model"
      helper="For generating topic names"
      paddingY={4}
      borderBottomWidth="1px"
    >
      <HStack>
        <Controller
          name={topicClusteringModelField.name}
          control={control}
          render={({ field }) => (
            <ModelSelector
              model={field.value}
              options={modelSelectorOptions
                .filter((option) => option.mode === "chat")
                .map((option) => option.value)}
              onChange={(model) => {
                field.onChange(model);
                void handleSubmit(onUpdateSubmit)();
              }}
              mode="chat"
            />
          )}
        />
        {updateTopicClusteringModel.isLoading && (
          <Spinner size="sm" marginRight={2} />
        )}
      </HStack>
    </HorizontalFormControl>
  );
}

export function EmbeddingsModel() {
  const { project } = useOrganizationTeamProject();
  const updateEmbeddingsModel = api.project.updateEmbeddingsModel.useMutation();

  const { register, handleSubmit, control } = useForm<EmbeddingsModelForm>({
    defaultValues: {
      embeddingsModel: project?.embeddingsModel ?? DEFAULT_EMBEDDINGS_MODEL,
    },
  });

  const embeddingsModelField = register("embeddingsModel");

  const onUpdateSubmit = useCallback(
    async (data: EmbeddingsModelForm) => {
      await updateEmbeddingsModel.mutateAsync({
        projectId: project?.id ?? "",
        embeddingsModel: data.embeddingsModel,
      });
      toaster.create({
        title: "Embeddings Model Updated",
        type: "success",
        duration: 3000,
        meta: {
          closable: true,
        },
      });
    },
    [updateEmbeddingsModel, project?.id],
  );

  return (
    <HorizontalFormControl
      label="Embeddings Model"
      helper="For embeddings to be used in topic clustering and evaluations"
      paddingY={4}
    >
      <HStack>
        <Controller
          name={embeddingsModelField.name}
          control={control}
          render={({ field }) => (
            <ModelSelector
              model={field.value}
              options={modelSelectorOptions
                .filter((option) => option.mode === "embedding")
                .map((option) => option.value)}
              onChange={(model) => {
                field.onChange(model);
                void handleSubmit(onUpdateSubmit)();
              }}
              mode="embedding"
            />
          )}
        />
        {updateEmbeddingsModel.isLoading && (
          <Spinner size="sm" marginRight={2} />
        )}
      </HStack>
    </HorizontalFormControl>
  );
}
