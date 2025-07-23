import { Flex, Spacer, VStack } from "@chakra-ui/react";
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Plus } from "react-feather";

import { DeleteConfirmationDialog } from "~/components/annotations/DeleteConfirmationDialog";
import { DashboardLayout } from "~/components/DashboardLayout";
import { CENTER_CONTENT_BOX_ID } from "~/components/executable-panel/InputOutputExecutablePanel";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { usePromptIdQueryParam } from "~/hooks/usePromptIdQueryParam";
import { PromptConfigPanel } from "~/prompt-configs/PromptConfigPanel";
import {
  createDefaultColumns,
  PromptConfigTable,
} from "~/prompt-configs/PromptConfigTable";
import type { LlmConfigWithLatestVersion } from "~/server/prompt-config/repositories/llm-config.repository";
import { api } from "~/utils/api";

/**
 * Custom hook for managing prompt configuration data operations and state.
 *
 * This hook encapsulates all logic for fetching, creating, and deleting prompt configs
 * for a given project, as well as managing the state for the delete confirmation dialog.
 *
 * Responsibilities:
 * - Fetch all prompt configs for the provided project.
 * - Handle creation of new prompt configs (with initial version).
 * - Handle deletion of prompt configs (with confirmation dialog).
 * - Expose state and handlers for dialog and CRUD operations.
 *
 * @param projectId The current project's ID, or undefined if not loaded.
 * @returns {
 *   promptConfigs: Array of prompt configs for the project,
 *   isLoading: Whether configs are being loaded,
 *   refetchPromptConfigs: Function to manually refetch configs,
 *   isDeleteDialogOpen: Whether the delete dialog is open,
 *   setIsDeleteDialogOpen: Setter for dialog open state,
 *   createConfig: Handler to create a new config,
 *   handleDeleteConfig: Handler to initiate delete dialog for a config,
 *   confirmDeleteConfig: Handler to confirm and perform deletion
 * }
 */
function usePromptConfigManagement(projectId: string | undefined) {
  const utils = api.useContext();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [configToDelete, setConfigToDelete] =
    useState<LlmConfigWithLatestVersion | null>(null);

  // Fetch all prompt configs for the current project.
  const {
    data: promptConfigs,
    refetch: refetchPromptConfigs,
    isLoading,
  } = api.llmConfigs.getPromptConfigs.useQuery(
    {
      projectId: projectId ?? "",
    },
    {
      enabled: !!projectId,
      onError: (error) => {
        // Show error toast if fetching fails
        toaster.create({
          title: "Error loading prompt configs",
          description: error.message,
          type: "error",
        });
      },
    }
  );

  // Mutation for creating a new prompt config with an initial version.
  const createConfigWithInitialVersionMutation =
    api.llmConfigs.createConfigWithInitialVersion.useMutation();

  // Mutation for deleting a prompt config.
  const deleteConfigMutation = api.llmConfigs.deletePromptConfig.useMutation({
    onSuccess: () => {
      // Invalidate prompt config cache and show success toast.
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
      // Show error toast if deletion fails
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

  /**
   * Create a new prompt config for the given project.
   * @param name Name for the new prompt config.
   * @param projectId Project ID to associate the config with.
   * @returns The created prompt config.
   */
  const createConfig = useCallback(
    async (name: string, projectId: string) => {
      const result = await createConfigWithInitialVersionMutation.mutateAsync({
        name,
        projectId,
      });
      void refetchPromptConfigs();
      return result;
    },
    [createConfigWithInitialVersionMutation, refetchPromptConfigs]
  );

  /**
   * Open the delete confirmation dialog for a given config.
   * @param config The config to delete.
   */
  const handleDeleteConfig = useCallback(
    (config: LlmConfigWithLatestVersion) => {
      setConfigToDelete(config);
      setIsDeleteDialogOpen(true);
    },
    [setConfigToDelete, setIsDeleteDialogOpen]
  );

  /**
   * Confirm and perform deletion of the selected config.
   * Shows error toast if deletion fails.
   */
  const confirmDeleteConfig = useCallback(async () => {
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
  }, [configToDelete, deleteConfigMutation, refetchPromptConfigs]);

  return {
    promptConfigs,
    isLoading,
    refetchPromptConfigs,
    isDeleteDialogOpen,
    setIsDeleteDialogOpen,
    createConfig,
    handleDeleteConfig,
    confirmDeleteConfig,
  };
}

/**
 * Page component for managing prompt configurations for a project.
 *
 * This page displays a table of all prompt configs for the current project,
 * allows users to create, edit, and delete configs, and shows a side panel
 * for editing the selected config. It also manages dialog state for confirming deletions.
 *
 * UI/UX Notes:
 * - The prompt config panel is absolutely positioned to overlay the table.
 * - The table area is scrollable, and the panel expands/collapses based on selection.
 * - The delete dialog requires the user to type 'delete' to confirm.
 */
export default function PromptConfigsPage() {
  // Get current project and prompt selection state from hooks.
  const { project } = useOrganizationTeamProject();
  const { selectedPromptId, setSelectedPromptId, clearSelection } =
    usePromptIdQueryParam();

  // State for whether the prompt config panel is expanded (visible).
  const [isPaneExpanded, setIsPaneExpanded] = useState(true); // Start open

  // Use custom hook to manage prompt config data and actions.
  const {
    promptConfigs,
    isLoading,
    isDeleteDialogOpen,
    setIsDeleteDialogOpen,
    createConfig,
    handleDeleteConfig,
    confirmDeleteConfig,
  } = usePromptConfigManagement(project?.id);

  // When a new prompt is selected, always expand the panel.
  useEffect(() => {
    if (selectedPromptId) {
      setIsPaneExpanded(true);
    }
  }, [selectedPromptId]);

  /**
   * Deselects the current prompt config, closing the side panel.
   */
  const closePanel = () => {
    clearSelection();
  };

  /**
   * Handler for creating a new prompt config.
   * Shows error toast if project ID is missing or creation fails.
   */
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

      // Create a new prompt config with default name.
      const result = await createConfig("New Prompt Config", project.id);
      setSelectedPromptId(result.id);
    } catch (error) {
      toaster.create({
        title: "Error creating prompt config",
        description: error instanceof Error ? error.message : "Unknown error",
        type: "error",
      });
    }
  };

  /**
   * Memoized table columns for prompt config table.
   * Handles edit and delete actions for each row.
   */
  const defaultColumns = useMemo(() => {
    return createDefaultColumns({
      onDelete: (config) => {
        handleDeleteConfig(config);
        return Promise.resolve();
      },
      onEdit: (config) => {
        setSelectedPromptId(config.id);
        return Promise.resolve();
      },
    });
  }, [setSelectedPromptId, handleDeleteConfig]);

  /**
   * NB: The styling and markup of this page is a bit hacky
   * and complicated because we need to both position the panel
   * absolutely to the page contents as well as allow for the table to
   * be able to scroll correctly. Please feel free to refactor this
   * if you can come up with a better way!
   *
   * Also, there's a chance that this won't work exactly as expected if the
   * panel changes size independently, but that's an edge case that can be
   * addressed if it comes up.
   *
   * @see https://github.com/langwatch/langwatch/pull/352#discussion_r2091220922
   */
  const panelRef = useRef<HTMLDivElement>(null);
  const centerContentElementRef: HTMLDivElement | null =
    panelRef.current?.querySelector(
      `#${CENTER_CONTENT_BOX_ID}`
    ) as HTMLDivElement | null;

  return (
    <DashboardLayout position="relative">
      {/* Main content outer wrapper for the prompt config table and panel */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
        }}
      >
        {/* Scrollable table area */}
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
                  onRowClick={(config) => {
                    setSelectedPromptId(config.id);
                    // Always expand the panel when a row is clicked
                    setIsPaneExpanded(true);
                  }}
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

        {/* Prompt config panel, absolutely positioned to overlay the table */}
        <VStack
          height="100%"
          maxHeight="100vh"
          position="absolute"
          top={0}
          width={
            isPaneExpanded && selectedPromptId
              ? "100%"
              : centerContentElementRef?.offsetWidth
          }
          right={0}
          bottom={0}
        >
          <PromptConfigPanel
            ref={panelRef}
            isOpen={!!selectedPromptId}
            onClose={closePanel}
            configId={selectedPromptId ?? ""}
            isPaneExpanded={isPaneExpanded}
            setIsPaneExpanded={setIsPaneExpanded}
          />
        </VStack>
      </div>
    </DashboardLayout>
  );
}
