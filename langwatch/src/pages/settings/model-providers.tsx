import {
  Badge,
  Box,
  Button,
  EmptyState,
  Heading,
  HStack,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { BrainCircuit, Edit, MoreVertical, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { useDrawer } from "~/hooks/useDrawer";
import { api } from "~/utils/api";
import { ProjectSelector } from "../../components/DashboardLayout";
import { HorizontalFormControl } from "../../components/HorizontalFormControl";
import {
  ModelSelector,
  modelSelectorOptions,
} from "../../components/ModelSelector";
import SettingsLayout from "../../components/SettingsLayout";
import { Dialog } from "../../components/ui/dialog";
import { Menu } from "../../components/ui/menu";
import { Tooltip } from "../../components/ui/tooltip";
import { useEmbeddingsModel } from "../../hooks/useEmbeddingsModel";
import { useModelProvidersSettings } from "../../hooks/useModelProvidersSettings";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useTopicClusteringModel } from "../../hooks/useTopicClusteringModel";
import { modelProviderIcons } from "../../server/modelProviders/iconsMap";
import { modelProviders as modelProvidersRegistry } from "../../server/modelProviders/registry";
import {
  DEFAULT_EMBEDDINGS_MODEL,
  DEFAULT_TOPIC_CLUSTERING_MODEL,
} from "../../utils/constants";
import {
  isProviderDefaultModel,
  isProviderEffectiveDefault,
  isProviderUsedForDefaultModels,
} from "../../utils/modelProviderHelpers";

export default function ModelsPage() {
  const { project, organization, organizations, hasPermission } =
    useOrganizationTeamProject();
  const hasModelProvidersManagePermission = hasPermission("project:manage");
  const { providers, isLoading, refetch } = useModelProvidersSettings({
    projectId: project?.id,
  });

  const { openDrawer, drawerOpen: isDrawerOpen } = useDrawer();
  const isProviderDrawerOpen = isDrawerOpen("editModelProvider");
  const updateMutation = api.modelProvider.update.useMutation();
  const [providerToDisable, setProviderToDisable] = useState<{
    id?: string;
    provider: string;
    name: string;
  } | null>(null);

  // Check if provider is used for the Default Model only (badge display)
  const isDefaultProvider = (providerKey: string) => {
    return isProviderDefaultModel(providerKey, project);
  };

  // Check if provider is used for any default models (for delete prevention)
  const isProviderUsedForAnyDefault = (providerKey: string) => {
    return isProviderEffectiveDefault(providerKey, project);
  };

  const utils = api.useContext();

  useEffect(() => {
    if (!isProviderDrawerOpen) {
      // Refetch both providers and organization data when drawer closes
      void refetch();
      void utils.organization.getAll.invalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProviderDrawerOpen]);

  const notEnabledProviders = useMemo(() => {
    return Object.keys(modelProvidersRegistry)
      .filter((providerKey) => {
        const providerData = providers?.[providerKey as keyof typeof providers];
        return !providerData?.enabled;
      })
      .map((providerKey) => ({
        provider: providerKey as keyof typeof modelProvidersRegistry,
        name:
          modelProvidersRegistry[
            providerKey as keyof typeof modelProvidersRegistry
          ]?.name ?? providerKey,
        icon: modelProviderIcons[
          providerKey as keyof typeof modelProviderIcons
        ],
      }));
  }, [providers]);

  const enabledProviders = useMemo(() => {
    if (!providers) return [];
    return Object.values(providers).filter((provider) => provider.enabled);
  }, [providers]);

  return (
    <SettingsLayout>
      <VStack gap={6} width="full" align="start">
        <HStack width="full" marginTop={2}>
          <Heading as="h2">Model Providers</Heading>
          <Spacer />
          {organizations && project && (
            <ProjectSelector organizations={organizations} project={project} />
          )}
          <Menu.Root>
            <Tooltip
              content="You need model provider manage permissions to add new providers."
              disabled={hasModelProvidersManagePermission}
            >
              <Menu.Trigger asChild>
                <PageLayout.HeaderButton
                  disabled={
                    !hasModelProvidersManagePermission ||
                    notEnabledProviders.length === 0
                  }
                >
                  <Plus /> Add Model Provider
                </PageLayout.HeaderButton>
              </Menu.Trigger>
            </Tooltip>
            <Menu.Content>
              {notEnabledProviders.map((provider) => (
                <Menu.Item
                  key={provider.provider}
                  value={provider.provider}
                  onClick={() => {
                    if (!project?.id) return;
                    openDrawer("editModelProvider", {
                      projectId: project.id,
                      organizationId: organization?.id,
                      providerKey: provider.provider,
                    });
                  }}
                >
                  <HStack gap={3}>
                    <Box width="20px" height="20px">
                      {provider.icon}
                    </Box>
                    <Text>{provider.name}</Text>
                  </HStack>
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Root>
        </HStack>

        {isLoading ? (
          <Spinner />
        ) : enabledProviders.length === 0 ? (
          <EmptyState.Root width="full">
            <EmptyState.Content>
              <EmptyState.Indicator>
                <BrainCircuit size={24} />
              </EmptyState.Indicator>
              <VStack textAlign="center">
                <EmptyState.Title>No model providers</EmptyState.Title>
                <EmptyState.Description>
                  Add a model provider to get started
                </EmptyState.Description>
              </VStack>
            </EmptyState.Content>
          </EmptyState.Root>
        ) : (
          <Table.Root width="full">
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Provider</Table.ColumnHeader>
                <Table.ColumnHeader />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {enabledProviders.map((provider) => {
                const providerIcon =
                  modelProviderIcons[
                    provider.provider as keyof typeof modelProviderIcons
                  ];
                const providerSpec =
                  modelProvidersRegistry[
                    provider.provider as keyof typeof modelProvidersRegistry
                  ];

                return (
                  <Table.Row key={provider.id ?? provider.provider}>
                    <Table.Cell>
                      <HStack gap={3} align="center">
                        <Box width="24px" height="24px">
                          {providerIcon}
                        </Box>
                        <Text>{providerSpec?.name ?? provider.provider}</Text>
                        {isDefaultProvider(provider.provider) && (
                          <Badge colorPalette="blue">Default Model</Badge>
                        )}
                      </HStack>
                    </Table.Cell>
                    <Table.Cell textAlign="right">
                      <Menu.Root>
                        <Tooltip
                          content="You need model provider manage permissions to edit or delete providers."
                          disabled={hasModelProvidersManagePermission}
                        >
                          <Menu.Trigger asChild>
                            <Button
                              variant="ghost"
                              disabled={!hasModelProvidersManagePermission}
                            >
                              <MoreVertical />
                            </Button>
                          </Menu.Trigger>
                        </Tooltip>
                        <Menu.Content>
                          <Menu.Item
                            value="edit"
                            onClick={(event) => {
                              event.stopPropagation();
                              openDrawer("editModelProvider", {
                                projectId: project?.id,
                                organizationId: organization?.id,
                                modelProviderId: provider.id,
                                providerKey: provider.provider,
                              });
                            }}
                          >
                            <Box display="flex" alignItems="center" gap={2}>
                              <Edit size={14} />
                              Edit Provider
                            </Box>
                          </Menu.Item>
                          <Menu.Item
                            value="disable"
                            color="red"
                            // css={{ color: "var(--chakra-colors-red-600)" }}
                            onClick={(event) => {
                              event.stopPropagation();
                              setProviderToDisable({
                                id: provider.id ?? undefined,
                                provider: provider.provider,
                                name: providerSpec?.name ?? provider.provider,
                              });
                            }}
                          >
                            <Box display="flex" alignItems="center" gap={2}>
                              <Trash2 size={14} />
                              Delete Provider
                            </Box>
                          </Menu.Item>
                        </Menu.Content>
                      </Menu.Root>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
        )}

        <Dialog.Root
          open={!!providerToDisable}
          onOpenChange={(details) => {
            if (!details.open) {
              setProviderToDisable(null);
            }
          }}
        >
          <Dialog.Content>
            <Dialog.Header>
              <Dialog.Title>Delete {providerToDisable?.name}?</Dialog.Title>
            </Dialog.Header>
            <Dialog.Body>
              {providerToDisable &&
              isProviderUsedForAnyDefault(providerToDisable.provider) ? (
                <VStack gap={3} align="start">
                  <Text>
                    This provider is currently being used for one or more
                    default models and cannot be deleted.
                  </Text>
                  <Text fontWeight="medium">
                    Please change the following before deleting:
                  </Text>
                  <VStack gap={2} align="start" paddingLeft={4}>
                    {isProviderUsedForDefaultModels(
                      providerToDisable.provider,
                      project?.defaultModel ?? null,
                      null,
                      null,
                    ) && <Text>• Default Model</Text>}
                    {isProviderUsedForDefaultModels(
                      providerToDisable.provider,
                      null,
                      null,
                      project?.embeddingsModel ?? null,
                    ) && <Text>• Embeddings Model</Text>}
                    {isProviderUsedForDefaultModels(
                      providerToDisable.provider,
                      null,
                      project?.topicClusteringModel ?? null,
                      null,
                    ) && <Text>• Topic Clustering Model</Text>}
                  </VStack>
                </VStack>
              ) : (
                <Text>This provider will no longer be available for use.</Text>
              )}
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.ActionTrigger asChild>
                <Button variant="outline">Cancel</Button>
              </Dialog.ActionTrigger>
              <Button
                colorPalette="red"
                loading={updateMutation.isPending}
                disabled={
                  providerToDisable
                    ? isProviderUsedForAnyDefault(providerToDisable.provider)
                    : false
                }
                onClick={async () => {
                  if (!providerToDisable) return;
                  if (!project?.id) return;
                  await updateMutation.mutateAsync({
                    id: providerToDisable.id,
                    projectId: project.id,
                    provider: providerToDisable.provider,
                    enabled: false,
                  });
                  setProviderToDisable(null);
                  await refetch();
                }}
              >
                Delete
              </Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger />
          </Dialog.Content>
        </Dialog.Root>
      </VStack>
    </SettingsLayout>
  );
}

export function TopicClusteringModel() {
  const { project } = useOrganizationTeamProject();
  const hook = useTopicClusteringModel({
    projectId: project?.id,
    initialValue:
      project?.topicClusteringModel ?? DEFAULT_TOPIC_CLUSTERING_MODEL,
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
