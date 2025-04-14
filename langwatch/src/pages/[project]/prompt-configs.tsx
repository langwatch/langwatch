import {
  Box,
  Button,
  Container,
  HStack,
  Heading,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus } from "react-feather";
import { DashboardLayout } from "~/components/DashboardLayout";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useEffect, useState, useMemo } from "react";
import {
  createDefaultColumns,
  PromptConfigTable,
} from "~/components/prompt-configs/PromptConfigTable";
import { PromptConfigPanel } from "~/components/prompt-configs/PromptConfigPanel";
import { toaster } from "~/components/ui/toaster";
// You'll need more imports when implementing the drawer/modal, etc.

export default function PromptConfigsPage() {
  const utils = api.useContext();
  const { project } = useOrganizationTeamProject();
  const [isPromptConfigPanelOpen, setIsPromptConfigPanelOpen] = useState(false);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);

  // Fetch prompt configs
  const { data: promptConfigs, isLoading: isLoadingPromptConfigs } =
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

    createConfigMutation.mutate({
      projectId: project.id,
      configData: {
        prompt: "You are a helpful assistant",
        model: "openai/gpt4-o-mini",
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
      },
      name: "New Prompt Config",
      schemaVersion: "1.0",
    });
  };

  useEffect(() => {
    if (selectedConfigId) {
      setIsPromptConfigPanelOpen(true);
    }
  }, [selectedConfigId]);

  console.log(promptConfigs);

  const defaultColumns = useMemo(() => {
    return createDefaultColumns({
      onDelete: (config) => {
        deleteConfigMutation.mutate({
          id: config.id,
          projectId: config.projectId,
        });
      },
    });
  }, [deleteConfigMutation]);

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
          isOpen={isPromptConfigPanelOpen}
          onClose={() => setIsPromptConfigPanelOpen(false)}
          configId={selectedConfigId ?? ""}
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
