import {
  Box,
  Button,
  Card,
  CardBody,
  Checkbox,
  Code,
  Grid,
  GridItem,
  HStack,
  Heading,
  Input,
  Skeleton,
  Spacer,
  Spinner,
  Switch,
  Table,
  Text,
  VStack,
  useToast,
  Thead,
  Tr,
  Th,
  Tbody,
  Td,
} from "@chakra-ui/react";
import { Edit2, Check } from "react-feather";
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
        {process.env.NEXT_PUBLIC_FEATURE_LLM_MODEL_COST && (
          <LmmModelCost projectId={project?.id} />
        )}
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

  const { register, handleSubmit, control } = useForm<TopicClusteringModelForm>(
    {
      defaultValues: {
        topicClusteringModel:
          project?.topicClusteringModel ?? allowedTopicClusteringModels[0]!,
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
                    void handleSubmit(onUpdateSubmit)();
                  }}
                  mode="chat"
                />
              )}
            />
          </HorizontalFormControl>
        </CardBody>
      </Card>
    </>
  );
}

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace NewLmmModelCostForm {
  export interface Props {
    projectId: string;
    onNewModel: (model: {
      model: string;
      regex: string;
      inputCostPerToken: number;
      outputCostPerToken: number;
    }) => Promise<void>;
  }
}

function NewLmmModelCostForm({
  projectId,
  onNewModel,
}: NewLmmModelCostForm.Props) {
  const [newModel, setNewModel] = React.useState({
    model: "",
    regex: "",
    inputCostPerToken: 0,
    outputCostPerToken: 0,
  });
  const createModel = api.llmModelCost.createModel.useMutation();

  const handleCreateModel = React.useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/await-thenable
    await createModel.mutate({
      projectId: projectId,
      model: newModel.model,
      regex: newModel.regex,
      inputCostPerToken: newModel.inputCostPerToken,
      outputCostPerToken: newModel.outputCostPerToken,
    });
    await onNewModel(newModel);
  }, [createModel, newModel, projectId, onNewModel]);

  return (
    <Tr>
      <Td>
        <Input
          placeholder="model name"
          defaultValue={newModel.model}
          onChange={(e) =>
            setNewModel((prev) => ({
              ...prev,
              model: e.target.value,
            }))
          }
        />
      </Td>
      <Td>
        <Input
          placeholder="match rule"
          defaultValue={newModel.regex}
          onChange={(e) =>
            setNewModel((prev) => ({
              ...prev,
              regex: e.target.value,
            }))
          }
        />
      </Td>
      <Td>
        <Input
          placeholder="input cost"
          defaultValue={newModel.inputCostPerToken}
          onChange={(e) =>
            setNewModel((prev) => ({
              ...prev,
              inputCostPerToken: Number(e.target.value),
            }))
          }
        />
      </Td>
      <Td>
        <Input
          placeholder="output cost"
          defaultValue={newModel.outputCostPerToken}
          onChange={(e) =>
            setNewModel((prev) => ({
              ...prev,
              outputCostPerToken: Number(e.target.value),
            }))
          }
        />
      </Td>
      <Td>
        <Button onClick={() => handleCreateModel()}>
          <Check />
        </Button>
      </Td>
    </Tr>
  );
}

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace LmmModelCost {
  export interface Props {
    projectId?: string;
  }
}

function LmmModelCost(props: LmmModelCost.Props) {
  const [showNewRow, setShowNewRow] = React.useState(false);

  const model = api.llmModelCost.getAllForProject.useQuery(
    { projectId: props.projectId ?? "" },
    { enabled: !!props.projectId }
  );
  const updateField = api.llmModelCost.updateField.useMutation();
  const handleUpdateField = useCallback(
    (event: EditableField.SubmitEvent<any>) => {
      updateField.mutate({
        projectId: props.projectId ?? "",
        model: event.model,
        field: event.fieldName as any,
        value:
          event.fieldName === "regex"
            ? String(event.value)
            : Number(event.value),
      });
    },
    [props.projectId, updateField]
  );

  const handleNewModel = useCallback(async () => {
    await model.refetch();
    setShowNewRow(false);
  }, [model, setShowNewRow]);

  return (
    <>
      <HStack width="full" marginTop={6}>
        <Heading size="md" as="h2">
          LMM Model Cost
        </Heading>
        <Spacer />
      </HStack>
      <Text>Define LLM model usage cost per token</Text>
      <Card width="full">
        <CardBody width="full" paddingY={0} paddingX={0}>
          <HStack width="full" paddingY={4} paddingX={4}>
            <Text fontSize="sm" color="gray.500">
              {model.data?.length} models
            </Text>
            <Button onClick={() => setShowNewRow(!showNewRow)}>+</Button>
          </HStack>
          <Table variant="simple" width="full">
            <Thead width="full">
              <Tr width="full">
                <Th>Model name</Th>
                <Th>Match rule</Th>
                <Th>Input cost</Th>
                <Th>Output cost</Th>
                <Th></Th>
              </Tr>
            </Thead>
            <Tbody width="full">
              {showNewRow && (
                <NewLmmModelCostForm
                  projectId={props.projectId!}
                  onNewModel={handleNewModel}
                />
              )}
              {model.data?.map((row) => (
                <Tr key={row.model} width="full">
                  <Td>
                    <Text
                      isTruncated
                      maxWidth="250px"
                      color={!!row.updatedAt ? "green.500" : void 0}
                    >
                      {row.model}
                    </Text>
                  </Td>
                  <Td p={0}>
                    <EditableField
                      onSubmit={handleUpdateField}
                      model={row.model}
                      value={String(row.regex)}
                      name="regex"
                      renderValue={(value) => (
                        <Code
                          isTruncated
                          maxWidth="250px"
                          color={!!row.updatedAt ? "green.500" : void 0}
                        >
                          {value}
                        </Code>
                      )}
                    />
                  </Td>
                  <Td p={0}>
                    <EditableField
                      onSubmit={handleUpdateField}
                      model={row.model}
                      name="inputCostPerToken"
                      value={row.inputCostPerToken}
                      renderValue={(value) => (
                        <Text color={!!row.updatedAt ? "green.500" : void 0}>
                          {value}
                        </Text>
                      )}
                    />
                  </Td>
                  <Td p={0}>
                    <EditableField
                      onSubmit={handleUpdateField}
                      model={row.model}
                      name="outputCostPerToken"
                      value={row.outputCostPerToken}
                      renderValue={(value) => (
                        <Text color={!!row.updatedAt ? "green.500" : void 0}>
                          {value}
                        </Text>
                      )}
                    />
                  </Td>
                  <Td></Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </CardBody>
      </Card>
    </>
  );
}

// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace EditableField {
  export interface SubmitEvent<V> {
    value: V;
    fieldName: string;
    model: string;
  }
  export interface Props<V> {
    value: V;
    name: string;
    model: string;
    renderValue: (value: V) => React.ReactNode;
    onSubmit?: (event: SubmitEvent<V>) => void;
  }

  export type State = "viewing" | "editing" | "saving";
}

function EditableField<V>({
  value,
  onSubmit,
  name,
  model,
  renderValue,
}: EditableField.Props<V>) {
  const [state, setState] = React.useState<EditableField.State>("viewing");
  const [valueState, setValueState] = React.useState<V>(value);

  const isEditing = state === "editing";
  const isViewing = state === "viewing";

  const handleState = React.useCallback(() => {
    setState((prevState) => {
      if (prevState === "viewing") {
        return "editing";
      }
      return "viewing";
    });
  }, [setState]);

  const handleBlur = React.useCallback(() => {
    setState("viewing");
  }, [setState]);

  const handleInputValueChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setValueState(e.target.value as any);
    },
    [setValueState]
  );

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        setState("viewing");
        if (onSubmit && valueState !== value) {
          onSubmit({
            value: valueState,
            fieldName: name,
            model: model,
          });
        }
      } else if (e.key === "Escape") {
        setValueState(value);
        setState("viewing");
      }
    },
    [valueState, setState, setValueState, onSubmit, value, model, name]
  );

  return (
    <HStack
      justifyContent="space-between"
      className="editable"
      sx={{
        ":hover": {
          bg: "gray.50",
        },
        lineHeight: "42px",
      }}
      onClick={handleState}
    >
      {isEditing && (
        <Input
          name={name}
          autoFocus={true}
          defaultValue={valueState !== undefined ? String(valueState) : ""}
          onBlur={handleBlur}
          onChange={handleInputValueChange}
          onKeyDown={handleKeyDown}
        />
      )}
      {isViewing && renderValue(valueState)}
      {isViewing && (
        <Box
          visibility="hidden"
          sx={{
            ".editable:hover & ": {
              visibility: "visible",
            },
          }}
        >
          <Edit2 size={16} />
        </Box>
      )}
    </HStack>
  );
}
