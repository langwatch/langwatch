import { useState } from "react";
import {
  Button,
  HStack,
  Text,
  VStack,
  createListCollection,
  useDisclosure,
} from "@chakra-ui/react";
import { Book, ChevronDown, Search } from "react-feather";
import { Dialog } from "../../../../components/ui/dialog";
import { Input } from "@chakra-ui/react";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";
import { api } from "../../../../utils/api";
import { toaster } from "../../../../components/ui/toaster";
import type { LlmPromptConfig, LlmPromptConfigVersion } from "@prisma/client";
import { InputGroup } from "../../../../components/ui/input-group";

interface PromptSourceProps {
  configId?: string; // Selected prompt ID
  onSelect: (config: {
    id: string;
    name: string;
    version: LlmPromptConfigVersion | undefined;
  }) => void;
}

export function PromptSource({ configId, onSelect }: PromptSourceProps) {
  const { project } = useOrganizationTeamProject();
  const [searchTerm, setSearchTerm] = useState("");
  const { open, onOpen, onClose } = useDisclosure();

  // Fetch all prompt configs
  const { data: promptConfigs, isLoading } =
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

  // Fetch the selected config with its latest version
  const { data: selectedConfig } = api.llmConfigs.getPromptConfigById.useQuery(
    {
      id: configId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!configId && !!project?.id,
    }
  );

  // Filter prompts based on search term
  const filteredPrompts =
    promptConfigs?.filter((config) =>
      config.name.toLowerCase().includes(searchTerm.toLowerCase())
    ) ?? [];

  // Handle prompt selection
  const handleSelectPrompt = (promptId: string) => {
    const selectedPrompt = promptConfigs?.find((p) => p.id === promptId);

    if (!selectedPrompt || !project?.id) return;

    // Using the proper API call method
    // Fetch the prompt config details
    const { refetch: fetchPromptConfig } =
      api.llmConfigs.getPromptConfigById.useQuery(
        {
          id: promptId,
          projectId: project.id,
        },
        {
          enabled: false,
        }
      );

    void fetchPromptConfig()
      .then(({ data: config }) => {
        if (config && config.versions.length > 0) {
          onSelect({
            id: selectedPrompt.id,
            name: selectedPrompt.name,
            version: config.versions[0], // Latest version
          });
          onClose();
        }
      })
      .catch((error: unknown) => {
        toaster.create({
          title: "Error loading prompt config",
          description: error instanceof Error ? error.message : "Unknown error",
          type: "error",
        });
      });
  };

  return (
    <>
      <Button
        onClick={onOpen}
        width="full"
        justifyContent="space-between"
        variant="outline"
      >
        <HStack width="full" justifyContent="space-between">
          <HStack>
            <Book size={16} />
            <Text>
              {selectedConfig ? selectedConfig.name : "Select a prompt"}
            </Text>
          </HStack>
          <ChevronDown size={16} />
        </HStack>
      </Button>

      <Dialog.Root
        open={open}
        onOpenChange={({ open }) => (open ? onOpen() : onClose())}
      >
        <Dialog.Content>
          <Dialog.Header>
            <Dialog.Title>Select a Prompt</Dialog.Title>
            <Dialog.CloseTrigger />
          </Dialog.Header>
          <Dialog.Body>
            <VStack align="stretch" gap={4} width="full">
              <HStack>
                <InputGroup flex="1" startElement={<Search size={16} />}>
                  <Input
                    placeholder="Search prompts..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </InputGroup>
              </HStack>

              {isLoading ? (
                <Text>Loading prompts...</Text>
              ) : filteredPrompts.length === 0 ? (
                <Text>
                  No prompts found. Create one in the prompt library first.
                </Text>
              ) : (
                <VStack align="stretch" gap={1}>
                  {filteredPrompts.map((prompt) => (
                    <Button
                      key={prompt.id}
                      variant="ghost"
                      justifyContent="flex-start"
                      data-active={prompt.id === value}
                      onClick={() => handleSelectPrompt(prompt.id)}
                      height="auto"
                      py={2}
                    >
                      <HStack gap={3} width="full">
                        <Book size={16} />
                        <VStack align="start" gap={0}>
                          <Text fontWeight="medium">{prompt.name}</Text>
                          <Text fontSize="xs" color="gray.500">
                            Updated:{" "}
                            {new Date(prompt.updatedAt).toLocaleDateString()}
                          </Text>
                        </VStack>
                      </HStack>
                    </Button>
                  ))}
                </VStack>
              )}
            </VStack>
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
