import {
  Box,
  Button,
  Card,
  CardBody,
  Checkbox,
  Grid,
  GridItem,
  HStack,
  Heading,
  Input,
  Skeleton,
  Spacer,
  Spinner,
  Switch,
  Text,
  VStack,
  useToast,
} from "@chakra-ui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import React, { useCallback } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { ProjectSelector } from "../../components/DashboardLayout";
import { HorizontalFormControl } from "../../components/HorizontalFormControl";
import SettingsLayout from "../../components/SettingsLayout";
import { SmallLabel } from "../../components/SmallLabel";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import {
  modelProviders as modelProvidersRegistry,
  type MaybeStoredModelProvider,
} from "../../server/modelProviders/registry";
import { api } from "../../utils/api";
import { ModelSelector } from "../../components/ModelSelector";
import { modelProviderIcons } from "../../server/modelProviders/iconsMap";
import { allowedTopicClusteringModels } from "../../server/topicClustering/types";

export default function ModelsPage() {
  const { project, organizations } = useOrganizationTeamProject();
  const modelProviders = api.modelProvider.getAllForProject.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project }
  );
  const updateMutation = api.modelProvider.update.useMutation();

  return (
    <SettingsLayout>
      <VStack
        paddingX={4}
        paddingY={6}
        spacing={6}
        width="full"
        maxWidth="920px"
        align="start"
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
        <Card width="full">
          <CardBody width="full" paddingY={4}>
            <VStack spacing={0} width="full">
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
          </CardBody>
        </Card>
        <TopicClusteringModel />
      </VStack>
    </SettingsLayout>
  );
}

type ModelProviderForm = {
  id?: string;
  provider: string;
  enabled: boolean;
  useCustomKeys: boolean;
  customKeys?: Record<string, unknown> | null;
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
  const { project } = useOrganizationTeamProject();

  const localUpdateMutation = api.modelProvider.update.useMutation();

  const providerDefinition =
    modelProvidersRegistry[
      provider.provider as keyof typeof modelProvidersRegistry
    ]!;

  const { register, handleSubmit, formState, watch, setValue } =
    useForm<ModelProviderForm>({
      defaultValues: {
        id: provider.id,
        provider: provider.provider,
        enabled: provider.enabled,
        useCustomKeys: !!provider.customKeys,
        customKeys: provider.customKeys as object | null,
      },
      resolver: (data, ...args) => {
        console.log("data", data);
        console.log("args", args);
        const data_ = {
          ...data,
          customKeys: data.useCustomKeys ? data.customKeys : null,
        };

        return zodResolver(
          z.object({
            id: z.string().optional(),
            provider: z.enum(Object.keys(modelProvidersRegistry) as any),
            enabled: z.boolean(),
            useCustomKeys: z.boolean(),
            customKeys: providerDefinition.keysSchema.optional().nullable(),
          })
        )(data_, ...args);
      },
    });

  const toast = useToast();

  const onSubmit = useCallback(
    async (data: ModelProviderForm) => {
      await localUpdateMutation.mutateAsync({
        id: provider.id,
        projectId: project?.id ?? "",
        provider: provider.provider,
        enabled: data.enabled,
        customKeys: data.useCustomKeys ? data.customKeys : null,
      });
      toast({
        title: "API Keys Updated",
        status: "success",
        duration: 3000,
        isClosable: true,
      });
      await refetch();
    },
    [
      localUpdateMutation,
      provider.id,
      provider.provider,
      project?.id,
      toast,
      refetch,
    ]
  );

  const enabledField = register("enabled");
  const onEnableDisable = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      void enabledField.onChange(e);
      await updateMutation.mutateAsync({
        id: provider.id,
        projectId: project?.id ?? "",
        provider: provider.provider,
        enabled: e.target.checked,
        customKeys: provider.customKeys as any,
      });
      await refetch();
    },
    [
      enabledField,
      updateMutation,
      provider.id,
      provider.provider,
      provider.customKeys,
      project?.id,
      refetch,
    ]
  );

  const useCustomKeysField = register("useCustomKeys");
  const onUseCustomKeysChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      await useCustomKeysField.onChange(e);
      if (!e.target.checked) {
        await updateMutation.mutateAsync({
          id: provider.id,
          projectId: project?.id ?? "",
          provider: provider.provider,
          enabled: provider.enabled,
          customKeys: null,
        });
        setValue("customKeys", null);
        await refetch();
      }
    },
    [
      useCustomKeysField,
      updateMutation,
      provider.id,
      provider.provider,
      provider.enabled,
      project?.id,
      setValue,
      refetch,
    ]
  );

  const providerKeys = providerDefinition.keysSchema.shape;
  const useCustomKeys = watch("useCustomKeys");

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
            <HStack paddingLeft={4}>
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
              <Text>{providerDefinition.name}</Text>
            </HStack>
          }
          helper={""}
        >
          <VStack align="start" width="full" spacing={4} paddingRight={4}>
            <HStack spacing={6}>
              {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
              <Switch {...enabledField} onChange={onEnableDisable}>
                Enabled
              </Switch>
              <Checkbox
                {...useCustomKeysField}
                // eslint-disable-next-line @typescript-eslint/no-misused-promises
                onChange={onUseCustomKeysChange}
              >
                Use custom API Keys
              </Checkbox>
            </HStack>
            {useCustomKeys && (
              <>
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
                      <GridItem alignContent="center" fontFamily="monospace">
                        {key}
                      </GridItem>
                      <GridItem>
                        <Input
                          {...register(`customKeys.${key}`)}
                          placeholder={
                            (providerDefinition.keysSchema.shape as any)[key]
                              ._def.typeName === "ZodOptional"
                              ? "optional"
                              : undefined
                          }
                          isInvalid={!!formState.errors.customKeys?.[key]}
                        />
                      </GridItem>
                    </React.Fragment>
                  ))}
                </Grid>
                <HStack width="full">
                  <Spacer />
                  <Button
                    type="submit"
                    size="sm"
                    colorScheme="orange"
                    isLoading={localUpdateMutation.isLoading}
                  >
                    Save
                  </Button>
                </HStack>
              </>
            )}
          </VStack>
        </HorizontalFormControl>
      </form>
    </Box>
  );
}

type TopicClusteringModelForm = {
  topicClusteringModel: string;
};

function TopicClusteringModel() {
  const { project } = useOrganizationTeamProject();
  const updateTopicClusteringModel =
    api.project.updateTopicClusteringModel.useMutation();

  const { register, handleSubmit, control } =
    useForm<TopicClusteringModelForm>({
      defaultValues: {
        topicClusteringModel:
          project?.topicClusteringModel ?? allowedTopicClusteringModels[0]!,
      },
    });

  const topicClusteringModelField = register("topicClusteringModel");

  const onSubmit = useCallback(
    async (data: TopicClusteringModelForm) => {
      await updateTopicClusteringModel.mutateAsync({
        projectId: project?.id ?? "",
        topicClusteringModel: data.topicClusteringModel,
      });
    },
    [updateTopicClusteringModel, project?.id]
  );

  return (
    <>
      <HStack width="full" marginTop={6}>
        <Heading size="md" as="h2">
          Topic Clustering Model
        </Heading>
        <Spacer />
        {updateTopicClusteringModel.isLoading && <Spinner />}
      </HStack>
      <Text>
        Select which model will be used to generate the topic names based on the
        messages
      </Text>
      <Card width="full">
        <CardBody width="full">
          <HorizontalFormControl label="Topic Clustering Model" helper="">
            <Controller
              name={topicClusteringModelField.name}
              control={control}
              render={({ field }) => (
                <ModelSelector
                  model={field.value}
                  options={allowedTopicClusteringModels}
                  // eslint-disable-next-line @typescript-eslint/no-misused-promises
                  onChange={(model) => {
                    field.onChange(model);
                    void handleSubmit(onSubmit)();
                  }}
                />
              )}
            />
          </HorizontalFormControl>
        </CardBody>
      </Card>
    </>
  );
}
