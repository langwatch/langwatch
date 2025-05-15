import { Flex, Spacer, VStack } from "@chakra-ui/react";
import { type LlmPromptConfig } from "@prisma/client";
import { useState, useMemo, useRef } from "react";
import { Plus } from "react-feather";

import { DeleteConfirmationDialog } from "~/components/annotations/DeleteConfirmationDialog";
import { DashboardLayout } from "~/components/DashboardLayout";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { PromptConfigPanel } from "~/prompt-configs/PromptConfigPanel";
import {
  createDefaultColumns,
  PromptConfigTable,
} from "~/prompt-configs/PromptConfigTable";
import { api } from "~/utils/api";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { CENTER_CONTENT_BOX_ID } from "~/components/executable-panel/InputOutputExecutablePanel";

export default function PromptConfigsPage() {
  const utils = api.useContext();
  const { project } = useOrganizationTeamProject();
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isPaneExpanded, setIsPaneExpanded] = useState(true); // Start open
  const [configToDelete, setConfigToDelete] = useState<LlmPromptConfig | null>(
    null
  );
  const closePanel = () => {
    setSelectedConfigId(null);
  };

  // Fetch prompt configs
  const {
    data: promptConfigs,
    refetch: refetchPromptConfigs,
    isLoading,
  } = api.llmConfigs.getPromptConfigs.useQuery(
    {
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id,
      onError: (error) => {
        toaster.create({
          title: "Error loading prompt configs from here",
          description: error.message,
          type: "error",
        });
      },
    }
  );

  const createConfigWithInitialVersionMutation =
    api.llmConfigs.createConfigWithInitialVersion.useMutation();

  const deleteConfigMutation = api.llmConfigs.deletePromptConfig.useMutation({
    onSuccess: () => {
      void utils.llmConfigs.getPromptConfigs.invalidate();
      toaster.create({
        title: "Prompt config deleted",
        type: "success",
        meta: {
          closable: true,
        },
      });
    },
    onError: (error) => {
      toaster.create({
        title: "Error deleting prompt config",
        description: error instanceof Error ? error.message : "Unknown error",
        type: "error",
        meta: {
          closable: true,
        },
      });
    },
  });

  const handleCreateButtonClick = async () => {
    try {
      if (!project?.id) {
        toaster.create({
          title: "Error",
          description: "Project ID is required",
          type: "error",
        });
        return;
      }

      // Create with defaults
      const result = await createConfigWithInitialVersionMutation.mutateAsync({
        name: "New Prompt Config",
        projectId: project.id,
      });

      setSelectedConfigId(result.id);
    } catch (error) {
      toaster.create({
        title: "Error creating prompt config",
        description: error instanceof Error ? error.message : "Unknown error",
        type: "error",
      });
    }

    void refetchPromptConfigs();
  };

  const handleDeleteConfig = (config: LlmPromptConfig) => {
    setConfigToDelete(config);
    setIsDeleteDialogOpen(true);
  };

  const confirmDeleteConfig = async () => {
    if (!configToDelete) return;

    try {
      await deleteConfigMutation.mutateAsync({
        id: configToDelete.id,
        projectId: configToDelete.projectId,
      });

      await refetchPromptConfigs();
    } catch (error) {
      toaster.create({
        title: "Error deleting prompt config",
        description: error instanceof Error ? error.message : "Unknown error",
        type: "error",
      });
    }
  };

  const defaultColumns = useMemo(() => {
    return createDefaultColumns({
      onDelete: (config) => {
        handleDeleteConfig(config);
        return Promise.resolve();
      },
      onEdit: (config) => {
        setSelectedConfigId(config.id);
        return Promise.resolve();
      },
    });
  }, []);

  /**
   * NB: The styling and markup of this page is a bit hacky
   * and complicated because we need to both position the panel
   * absolutely to the page contents as well as allow for the table to
   * be able to scroll correctly. Please feel free to refactor this
   * if you can come up with a better way!
   */
  const panelRef = useRef<HTMLDivElement>(null);
  const centerContentElementRef: HTMLDivElement | null =
    panelRef.current?.querySelector(
      `#${CENTER_CONTENT_BOX_ID}`
    ) as HTMLDivElement | null;

  return (
    <DashboardLayout position="relative">
      {/* Main content outer wrapper */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
        }}
      >
        {/* Main content inner wrapper for the table -- allows for scrolling */}
        <div
          style={{
            position: "absolute",
            height: "100%",
            width: "100%",
            overflow: "scroll",
          }}
        >
          <Flex flexDirection="column" height="100%">
            <PageLayout.Container
              maxW={"calc(100vw - 200px)"}
              padding={6}
              marginTop={8}
            >
              <PageLayout.Header>
                <PageLayout.Heading>Prompts</PageLayout.Heading>
                <Spacer />
                <PageLayout.HeaderButton
                  onClick={() => void handleCreateButtonClick()}
                >
                  <Plus height={16} /> Create New
                </PageLayout.HeaderButton>
              </PageLayout.Header>
              <PageLayout.Content>
                <PromptConfigTable
                  configs={promptConfigs ?? []}
                  isLoading={isLoading}
                  onRowClick={(config) => setSelectedConfigId(config.id)}
                  columns={defaultColumns}
                />
              </PageLayout.Content>

              <DeleteConfirmationDialog
                title="Are you really sure?"
                description="There is no going back, and you will lose all versions of this prompt. If you're sure you want to delete this prompt, type 'delete' below:"
                open={isDeleteDialogOpen}
                onClose={() => setIsDeleteDialogOpen(false)}
                onConfirm={() => {
                  void confirmDeleteConfig();
                }}
              />
            </PageLayout.Container>
          </Flex>
        </div>

        {/* Prompt config panel with absolute position wrapper */}
        <VStack
          height="100%"
          maxHeight="100vh"
          position="absolute"
          top={0}
          width={
            isPaneExpanded && selectedConfigId
              ? "100%"
              : centerContentElementRef?.offsetWidth
          }
          right={0}
          bottom={0}
        >
          <PromptConfigPanel
            ref={panelRef}
            isOpen={!!selectedConfigId}
            onClose={closePanel}
            configId={selectedConfigId ?? ""}
            isPaneExpanded={isPaneExpanded}
            setIsPaneExpanded={setIsPaneExpanded}
          />
        </VStack>
      </div>
    </DashboardLayout>
  );
}
