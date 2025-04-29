import {
  Button,
  Container,
  HStack,
  Heading,
  VStack,
  Flex,
} from "@chakra-ui/react";
import { type LlmPromptConfig } from "@prisma/client";
import { useState, useMemo } from "react";
import { Plus } from "react-feather";

import { DeleteConfirmationDialog } from "~/components/annotations/DeleteConfirmationDialog";
import { DashboardLayout } from "~/components/DashboardLayout";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { PromptConfigPanel } from "~/prompt-configs/components/PromptConfigPanel";
import {
  createDefaultColumns,
  PromptConfigTable,
} from "~/prompt-configs/components/PromptConfigTable";
import { api } from "~/utils/api";

export default function PromptConfigsPage() {
  const utils = api.useContext();
  const { project } = useOrganizationTeamProject();
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [configToDelete, setConfigToDelete] = useState<LlmPromptConfig | null>(
    null
  );
  const closePanel = () => {
    setSelectedConfigId(null);
  };

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
      await createConfigWithInitialVersionMutation.mutateAsync({
        name: "New Prompt Config",
        projectId: project.id,
      });
    } catch (error) {
      toaster.create({
        title: "Error creating prompt config",
        description: error instanceof Error ? error.message : "Unknown error",
        type: "error",
      });
    }

    void refetchPromptConfigs();
    toaster.create({
      title: "Prompt config created",
      type: "success",
      meta: {
        closable: true,
      },
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
    <DashboardLayout position="relative">
      <Flex
        flexDirection="column"
        height="100%"
        width="100%"
        position="relative"
      >
        <Container padding={6} height="full" width="full">
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

          <DeleteConfirmationDialog
            title="Are you really sure?"
            description="There is no going back, and you will lose all versions of this prompt. If you're sure you want to delete this prompt, type 'delete' below:"
            open={isDeleteDialogOpen}
            onClose={() => setIsDeleteDialogOpen(false)}
            onConfirm={() => {
              void confirmDeleteConfig();
            }}
          />
        </Container>
        <PromptConfigPanel
          isOpen={!!selectedConfigId}
          onClose={closePanel}
          configId={selectedConfigId ?? ""}
        />
      </Flex>
    </DashboardLayout>
  );
}
