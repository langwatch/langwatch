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
import { zodResolver } from "@hookform/resolvers/zod";
import React, { useCallback } from "react";
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

/**
 * Handles creating multiple options from comma-separated input
 * Single Responsibility: Split comma-separated text and add as multiple options
 */
const handleCreateMultipleOptions = (
  newValue: string,
  currentValue: { label: string; value: string }[],
  onChange: (value: { label: string; value: string }[]) => void
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
  const { project, organizations } = useOrganizationTeamProject();
  const modelProviders = api.modelProvider.getAllForProjectForFrontend.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project }
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
                Object.values(modelProviders.data).map((provider, index) => (
                  <ModelProviderForm
                    key={index}
                    provider={provider}
                    refetch={modelProviders.refetch}
                    updateMutation={updateMutation}
                  />
                ))}
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
                <DefaultModel />
                <TopicClusteringModel />
                <EmbeddingsModel />
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

  const localUpdateMutation = api.modelProvider.update.useMutation();

  const providerDefinition =
    modelProvidersRegistry[
      provider.provider as keyof typeof modelProvidersRegistry
    ];

  const getStoredModelOptions = (
    models: string[],
    provider: string,
    mode: "chat" | "embedding"
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
      customKeys: provider.customKeys as object | null,
      customModels: getStoredModelOptions(
        provider.models ?? [],
        provider.provider,
        "chat"
      ),
      customEmbeddingsModels: getStoredModelOptions(
        provider.embeddingsModels ?? [],
        provider.provider,
        "embedding"
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
              })
            )
            .optional()
            .nullable(),
          customEmbeddingsModels: z
            .array(
              z.object({
                value: z.string(),
                label: z.string(),
              })
            )
            .optional()
            .nullable(),
        })
      )(data_, ...args);
    },
  });
  const { register, handleSubmit, formState, watch, setValue, control } = form;

  const onSubmit = useCallback(
    async (data: ModelProviderForm) => {
      await localUpdateMutation.mutateAsync({
        id: provider.id,
        projectId: project?.id ?? "",
        provider: provider.provider,
        enabled: data.enabled,
        customKeys: data.customKeys,
        customModels: (data.customModels ?? []).map((m) => m.value),
        customEmbeddingsModels: (data.customEmbeddingsModels ?? []).map(
          (m) => m.value
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
    [localUpdateMutation, provider.id, provider.provider, project?.id, refetch]
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
    ]
  );

  const providerKeys = providerDefinition?.keysSchema
    ? "shape" in providerDefinition.keysSchema
      ? providerDefinition.keysSchema.shape
      : providerDefinition.keysSchema._def.schema.shape
    : {};

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
                      {Object.keys(providerKeys).map((key) => (
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
                                (providerKeys as any)[key]._def.typeName ===
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
                              field.onChange
                            );
                          }}
                          isMulti
                          options={getProviderModelOptions(
                            provider.provider,
                            "chat"
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
                                  field.onChange
                                );
                              }}
                              isMulti
                              options={getProviderModelOptions(
                                provider.provider,
                                "embedding"
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
    [updateDefaultModel, project?.id]
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

function TopicClusteringModel() {
  const { project } = useOrganizationTeamProject();
  const updateTopicClusteringModel =
    api.project.updateTopicClusteringModel.useMutation();

  const { register, handleSubmit, control } = useForm<TopicClusteringModelForm>(
    {
      defaultValues: {
        topicClusteringModel:
          project?.topicClusteringModel ?? DEFAULT_TOPIC_CLUSTERING_MODEL,
      },
    }
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
    [updateTopicClusteringModel, project?.id]
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

function EmbeddingsModel() {
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
    [updateEmbeddingsModel, project?.id]
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
