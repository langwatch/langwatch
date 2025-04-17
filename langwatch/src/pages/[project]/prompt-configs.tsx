import { Button, Container, HStack, Heading, VStack } from "@chakra-ui/react";
import { Plus } from "react-feather";
import { DashboardLayout } from "~/components/DashboardLayout";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useState, useMemo } from "react";
import {
  createDefaultColumns,
  PromptConfigTable,
} from "~/prompt-configs/PromptConfigTable";
import { PromptConfigPanel } from "~/prompt-configs/PromptConfigPanel";
import { toaster } from "~/components/ui/toaster";
import { DeleteConfirmationDialog } from "~/components/annotations/DeleteConfirmationDialog";
import { type LlmPromptConfig } from "@prisma/client";
import { LATEST_SCHEMA_VERSION } from "~/server/repositories/llm-config-version-schema";

export default function PromptConfigsPage() {
  const utils = api.useContext();
  const { project } = useOrganizationTeamProject();
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [configToDelete, setConfigToDelete] = useState<LlmPromptConfig | null>(
    null
  );

  // Fetch prompt configs
  const { data: promptConfigs, refetch: refetchPromptConfigs } =
    api.llmConfigs.getPromptConfigs.useQuery(
      {
        projectId: project?.id ?? "",
      },
      {
        enabled: !!project?.id,
        onError: (error) => {
          toaster.create({
            title: "Error loading prompt configs",
            description: error.message,
            type: "error",
          });
        },
      }
    );

  const createConfigMutation = api.llmConfigs.createPromptConfig.useMutation({
    onSuccess: ({ id }) => {
      void utils.llmConfigs.getPromptConfigs.invalidate();
      setSelectedConfigId(id);
      void refetchPromptConfigs();
    },
    onError: (error) => {
      toaster.create({
        title: "Error creating prompt config",
        description: error.message,
        type: "error",
      });
    },
  });

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

  const createConfigVersionMutation =
    api.llmConfigs.versions.create.useMutation({
      onSuccess: () => {
        void utils.llmConfigs.getPromptConfigs.invalidate();
        void refetchPromptConfigs();
      },
    });

  const handleCreateButtonClick = async () => {
    if (!project?.id) {
      toaster.create({
        title: "Error",
        description: "Project ID is required",
        type: "error",
      });
      return;
    }

    // Create with defaults
    const newConfig = await createConfigMutation.mutateAsync({
      name: "New Prompt Config",
      projectId: project.id,
    });

    // Create with defaults
    await createConfigVersionMutation.mutateAsync({
      configId: newConfig.id,
      projectId: project.id,
      configData: {
        model: "gpt-4o-mini",
        prompt: "You are a helpful assistant",
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        demonstrations: {
          columns: [],
          rows: [],
        },
      },
      schemaVersion: LATEST_SCHEMA_VERSION,
      commitMessage: "Initial version",
    });
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
    });
  }, []);

  return (
    <DashboardLayout>
      <Container
        maxW={"calc(100vw - 200px)"}
        padding={6}
        // marginTop={8}
        position="relative"
        height="full"
      >
        <VStack align="start" width="full">
          {/* Header with title and "Create New" button */}
          <HStack width="full" justifyContent="space-between">
            <Heading as="h1" size="lg">
              Prompts
            </Heading>
            <Button
              colorPalette="blue"
              minWidth="fit-content"
              onClick={() => void handleCreateButtonClick()}
            >
              <Plus height={16} /> Create New
            </Button>
          </HStack>
          <PromptConfigTable
            configs={promptConfigs ?? []}
            isLoading={false}
            onRowClick={(config) => setSelectedConfigId(config.id)}
            columns={defaultColumns}
          />
        </VStack>
        <PromptConfigPanel
          isOpen={!!selectedConfigId}
          onClose={() => setSelectedConfigId(null)}
          configId={selectedConfigId ?? ""}
        />

        <DeleteConfirmationDialog
          title="Are you really sure?"
          description="There is no going back, and you will lose all versions of this prompt. If you're sure you want to delete this prompt, type 'delete' below:"
          open={isDeleteDialogOpen}
          onClose={() => setIsDeleteDialogOpen(false)}
          onConfirm={() => {
            void confirmDeleteConfig();
          }}
        />

        {/* You'll need to implement drawer/modal components for:
          - Creating a new config
          - Editing a config name
          - Viewing/managing versions
          - Creating a new version
      */}
      </Container>
    </DashboardLayout>
  );
}
