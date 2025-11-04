import {
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
import { Trash2, Plus, Eye, EyeOff } from "react-feather";
import React from "react";
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

import CreatableSelect from "react-select/creatable";
import { Switch } from "../../components/ui/switch";

import {
  DEFAULT_EMBEDDINGS_MODEL,
  DEFAULT_TOPIC_CLUSTERING_MODEL,
  DEFAULT_MODEL,
  KEY_CHECK,
} from "../../utils/constants";
import { dependencies } from "../../injection/dependencies.client";
import { PermissionAlert } from "../../components/PermissionAlert";
import { useModelProvidersSettings } from "../../hooks/useModelProvidersSettings";
import { useModelProviderForm } from "../../hooks/useModelProviderForm";
import { useDefaultModel } from "../../hooks/useDefaultModel";
import { useTopicClusteringModel } from "../../hooks/useTopicClusteringModel";
import { useEmbeddingsModel } from "../../hooks/useEmbeddingsModel";

// (moved: multi-create logic now lives inside the per-provider hook)

export default function ModelsPage() {
  const { project, organizations, hasPermission } =
    useOrganizationTeamProject();
  const hasModelProvidersManagePermission = hasPermission("project:manage");
  const { providers, isLoading, refetch } = useModelProvidersSettings({
    projectId: project?.id,
  });

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
          {/* aggregate spinner removed; per-row loading shown inline */}
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
              {isLoading &&
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

              {providers &&
                hasModelProvidersManagePermission &&
                Object.values(providers).map((provider, index) => (
                  <ModelProviderRow
                    key={index}
                    provider={provider}
                    refetch={refetch}
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

function ModelProviderRow({
  provider,
  refetch,
}: {
  provider: MaybeStoredModelProvider;
  refetch: () => Promise<any>;
}) {
  const { project, organization } = useOrganizationTeamProject();
  const [state, actions] = useModelProviderForm({
    provider,
    projectId: project?.id,
    onSuccess: () => {
      void refetch();
    },
  });

  const providerDefinition =
    modelProvidersRegistry[
      provider.provider as keyof typeof modelProvidersRegistry
    ];

  const ManagedModelProvider = dependencies.managedModelProviderComponent?.({
    projectId: project?.id ?? "",
    organizationId: organization?.id ?? "",
    provider,
  });
  const ManagedModelProviderAny = ManagedModelProvider as any;

  return (
    <Box
      width="full"
      borderBottomWidth="1px"
      _last={{ border: "none" }}
      paddingY={2}
    >
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
                  onCheckedChange={(details) => {
                    void actions.setEnabled(details.checked);
                  }}
                  checked={state.enabled}
                >
                  Enabled
                </Switch>
              </Field.Root>
              {state.isToggling && <Spinner size="sm" />}
            </HStack>
            {provider.provider === "azure" && state.enabled && (
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
          </HStack>

          {state.enabled && (
            <>
              {ManagedModelProviderAny ? (
                React.createElement(ManagedModelProviderAny, { provider })
              ) : (
                <Field.Root invalid={!!state.errors.customKeysRoot}>
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
                    {Object.keys(state.displayKeys).map((key) => (
                      <React.Fragment key={key}>
                        <GridItem alignContent="center" fontFamily="monospace">
                          {key}
                        </GridItem>
                        <GridItem>
                          <Input
                            value={state.customKeys[key] ?? ""}
                            onChange={(e) => actions.setCustomKey(key, e.target.value)}
                            type={
                              KEY_CHECK.some((k) => key.includes(k))
                                ? "password"
                                : "text"
                            }
                            autoComplete="off"
                            placeholder={
                              (state.displayKeys as any)[key]?._def?.typeName ===
                              "ZodOptional"
                                ? "optional"
                                : undefined
                            }
                          />
                        </GridItem>
                      </React.Fragment>
                    ))}
                  </Grid>
                  <Field.ErrorText>{state.errors.customKeysRoot}</Field.ErrorText>
                </Field.Root>
              )}

              {(provider.provider === "azure" || provider.provider === "custom") &&
                state.enabled && (
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
                        {state.extraHeaders.map((h, index) => (
                          <React.Fragment key={index}>
                            <GridItem>
                              <Input
                                value={h.key}
                                onChange={(e) =>
                                  actions.setExtraHeaderKey(index, e.target.value)
                                }
                                placeholder="Header name"
                                autoComplete="off"
                              />
                            </GridItem>
                            <GridItem>
                              <Input
                                value={h.value}
                                onChange={(e) =>
                                  actions.setExtraHeaderValue(index, e.target.value)
                                }
                                type={h.concealed ? "password" : "text"}
                                placeholder="Header value"
                                autoComplete="off"
                              />
                            </GridItem>
                            <GridItem>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => actions.toggleExtraHeaderConcealed(index)}
                              >
                                {h.concealed ? <EyeOff size={16} /> : <Eye size={16} />}
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
                      <Button size="xs" variant="outline" onClick={actions.addExtraHeader}>
                        <Plus size={16} />
                        Add Header
                      </Button>
                    </HStack>
                  </VStack>
                )}

              <VStack width="full" gap={4}>
                <Box width="full" maxWidth="408px">
                  <SmallLabel>Models</SmallLabel>
                  <CreatableSelect
                    value={state.customModels}
                    onChange={(v) => actions.setCustomModels((v as any) ?? [])}
                    onCreateOption={(text) => actions.addCustomModelsFromText(text)}
                    isMulti
                    options={getProviderModelOptions(provider.provider, "chat")}
                    placeholder="Add custom model"
                  />
                </Box>
                {(provider.provider === "openai" ||
                  provider.provider === "azure" ||
                  provider.provider === "gemini" ||
                  provider.provider === "bedrock") && (
                  <>
                    <Box width="full">
                      <SmallLabel>Embeddings Models</SmallLabel>
                      <CreatableSelect
                        value={state.customEmbeddingsModels}
                        onChange={(v) =>
                          actions.setCustomEmbeddingsModels((v as any) ?? [])
                        }
                        onCreateOption={(text) =>
                          actions.addCustomEmbeddingsFromText(text)
                        }
                        isMulti
                        options={getProviderModelOptions(
                          provider.provider,
                          "embedding",
                        )}
                        placeholder="Add custom embeddings model"
                      />
                    </Box>
                  </>
                )}
              </VStack>

              <HStack width="full">
                <Spacer />
                <Button
                  size="sm"
                  colorPalette="orange"
                  loading={state.isSaving}
                  onClick={() => {
                    void actions.submit();
                  }}
                >
                  Save
                </Button>
              </HStack>
            </>
          )}
        </VStack>
      </HorizontalFormControl>
    </Box>
  );
}

function DefaultModel() {
  const { project } = useOrganizationTeamProject();
  const hook = useDefaultModel({
    projectId: project?.id,
    initialValue: project?.defaultModel ?? DEFAULT_MODEL,
  });

  return (
    <HorizontalFormControl
      label="Default Model"
      helper="For general tasks within LangWatch"
      paddingY={4}
      borderBottomWidth="1px"
    >
      <HStack>
        <ModelSelector
          model={hook.value}
          options={modelSelectorOptions
            .filter((option) => option.mode === "chat")
            .map((option) => option.value)}
          onChange={(model) => {
            hook.setValue(model);
            void hook.update(model);
          }}
          mode="chat"
        />
        {hook.isSaving && <Spinner size="sm" marginRight={2} />}
      </HStack>
    </HorizontalFormControl>
  );
}

export function TopicClusteringModel() {
  const { project } = useOrganizationTeamProject();
  const hook = useTopicClusteringModel({
    projectId: project?.id,
    initialValue: project?.topicClusteringModel ?? DEFAULT_TOPIC_CLUSTERING_MODEL,
  });

  return (
    <HorizontalFormControl
      label="Topic Clustering Model"
      helper="For generating topic names"
      paddingY={4}
      borderBottomWidth="1px"
    >
      <HStack>
        <ModelSelector
          model={hook.value}
          options={modelSelectorOptions
            .filter((option) => option.mode === "chat")
            .map((option) => option.value)}
          onChange={(model) => {
            hook.setValue(model);
            void hook.update(model);
          }}
          mode="chat"
        />
        {hook.isSaving && <Spinner size="sm" marginRight={2} />}
      </HStack>
    </HorizontalFormControl>
  );
}

export function EmbeddingsModel() {
  const { project } = useOrganizationTeamProject();
  const hook = useEmbeddingsModel({
    projectId: project?.id,
    initialValue: project?.embeddingsModel ?? DEFAULT_EMBEDDINGS_MODEL,
  });

  return (
    <HorizontalFormControl
      label="Embeddings Model"
      helper="For embeddings to be used in topic clustering and evaluations"
      paddingY={4}
    >
      <HStack>
        <ModelSelector
          model={hook.value}
          options={modelSelectorOptions
            .filter((option) => option.mode === "embedding")
            .map((option) => option.value)}
          onChange={(model) => {
            hook.setValue(model);
            void hook.update(model);
          }}
          mode="embedding"
        />
        {hook.isSaving && <Spinner size="sm" marginRight={2} />}
      </HStack>
    </HorizontalFormControl>
  );
}
