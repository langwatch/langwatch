import {
  Badge,
  Box,
  Button,
  Card,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { UnplugIcon } from "lucide-react";
import { Edit, MoreVertical, Trash2 } from "react-feather";

import { GeneratePromptApiSnippetDialog } from "./components/GeneratePromptApiSnippetDialog";

import { Menu } from "~/components/ui/menu";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { formatTimeAgo } from "../utils/formatTimeAgo";
import { CopyButton } from "../components/CopyButton";
import { GenerateApiSnippetButton } from "../components/GenerateApiSnippetButton";
import { LLMModelDisplay } from "../components/llmPromptConfigs/LLMModelDisplay";
import { Tooltip } from "../components/ui/tooltip";
import { LuBuilding } from "react-icons/lu";

/**
 * Flat interface for prompt list items
 */
interface PromptListItem {
  id: string;
  name: string | null;
  handle: string | null;
  scope: "ORGANIZATION" | "PROJECT";
  updatedAt: Date;
  version: number;
  prompt: string;
  model: string | null;
  author?: {
    name: string;
  } | null;
}

/**
 * Props for the PromptsList component
 */
interface PromptsListProps {
  prompts: PromptListItem[];
  isLoading?: boolean;
  onDelete: (config: PromptListItem) => Promise<void>;
  onEdit: (config: PromptListItem) => Promise<void>;
}

/**
 * Component for displaying a list of prompt
 */
export function PromptsList({
  prompts,
  isLoading,
  onDelete,
  onEdit,
}: PromptsListProps) {
  const { project } = useOrganizationTeamProject();

  if (!project || isLoading) {
    return <Text>Loading prompts...</Text>;
  }

  if (prompts.length === 0) {
    return (
      <Box
        textAlign="center"
        py={10}
        px={6}
        borderWidth="1px"
        borderRadius="md"
        borderStyle="dashed"
        width="full"
      >
        <Text fontSize="lg" color="gray.600" textAlign="center">
          No prompts found. Create your first one!
        </Text>
      </Box>
    );
  }

  return (
    <VStack gap={4} align="stretch">
      {prompts.map((config) => (
        <GeneratePromptApiSnippetDialog
          key={config.id}
          promptHandle={config.handle}
          apiKey={project?.apiKey}
        >
          <Card.Root
            key={config.id}
            cursor="pointer"
            onClick={() => void onEdit(config)}
            transition="all 0.2s"
            _hover={{
              transform: "translateY(-2px)",
              shadow: "md",
            }}
            borderWidth="1px"
            borderColor="gray.200"
            _dark={{
              borderColor: "gray.700",
            }}
          >
            <Card.Header pb={3}>
              <HStack justify="space-between" align="flex-start">
                <Box flex="1">
                  {config.handle ? (
                    <HStack width="full" gap={1}>
                      {/* For legacy prompts, show the name */}
                      {config.handle === config.id && config.name ? (
                        <>
                          <Text fontFamily="mono" fontWeight="bold">
                            {config.name}
                          </Text>
                          <Text
                            fontWeight="normal"
                            color="gray.500"
                            fontFamily="mono"
                          >
                            ({config.handle})
                          </Text>
                        </>
                      ) : (
                        <Text fontFamily="mono" fontWeight="bold">
                          {config.handle}
                        </Text>
                      )}
                      <CopyButton
                        value={config.handle ?? ""}
                        label="Prompt ID"
                      />
                      <HStack gap={3}>
                        <Badge
                          colorPalette="green"
                          border="1px solid"
                          borderColor="green.200"
                        >
                          v{config.version}
                        </Badge>
                        {config.scope === "ORGANIZATION" && (
                          <Tooltip content="This prompt is available to all projects in the organization">
                            <Badge colorPalette="purple" variant="outline">
                              <HStack>
                                <LuBuilding />
                                Organization
                              </HStack>
                            </Badge>
                          </Tooltip>
                        )}
                        {config.model && (
                          <HStack gap={2} align="center">
                            <LLMModelDisplay model={config.model} />
                          </HStack>
                        )}
                      </HStack>
                    </HStack>
                  ) : (
                    <Badge size="lg">Draft</Badge>
                  )}
                </Box>
                <Box onClick={(e) => e.stopPropagation()}>
                  <Menu.Root>
                    <Menu.Trigger asChild>
                      <Button
                        variant={"ghost"}
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                      >
                        <MoreVertical />
                      </Button>
                    </Menu.Trigger>
                    <Menu.Content
                      onClick={(event) => {
                        // Prevent clicking from bubbling up to the onRowClick handler
                        event.stopPropagation();
                      }}
                    >
                      <Menu.Item
                        value="edit"
                        onClick={(_event) => {
                          void onEdit(config);
                        }}
                      >
                        <Edit size={16} /> Edit prompt
                      </Menu.Item>
                      <Menu.Item value="generate-api-snippet">
                        <GeneratePromptApiSnippetDialog.Trigger>
                          <HStack>
                            <UnplugIcon />
                            <Text>Show API code snippet</Text>
                          </HStack>
                        </GeneratePromptApiSnippetDialog.Trigger>
                      </Menu.Item>
                      <Menu.Item
                        value="delete"
                        color="red.600"
                        onClick={(_event) => {
                          void onDelete(config);
                        }}
                      >
                        <Trash2 size={16} /> Delete prompt
                      </Menu.Item>
                    </Menu.Content>
                  </Menu.Root>
                </Box>
              </HStack>
            </Card.Header>

            <Card.Body pt={0} pb={4}>
              <Box
                bg="gray.50"
                _dark={{ bg: "gray.800" }}
                p={4}
                borderRadius="md"
                fontFamily="mono"
                fontSize="sm"
                lineHeight="1.5"
                overflow="hidden"
                position="relative"
              >
                <Text
                  whiteSpace="pre-wrap"
                  lineClamp={4}
                  color="gray.700"
                  _dark={{ color: "gray.300" }}
                >
                  {config.prompt.trim() === "" ? "<empty>" : config.prompt}
                </Text>
              </Box>

              <HStack
                justify="space-between"
                align="center"
                mt={4}
                pt={3}
                borderTopWidth="1px"
                borderColor="gray.100"
                _dark={{ borderColor: "gray.700" }}
              >
                <UpdatedInfo
                  author={config.author}
                  updatedAt={config.updatedAt}
                />

                <HStack gap={2}>
                  <GeneratePromptApiSnippetDialog.Trigger>
                    <GenerateApiSnippetButton hasHandle={!!config.handle} />
                  </GeneratePromptApiSnippetDialog.Trigger>
                </HStack>
              </HStack>
            </Card.Body>
          </Card.Root>
        </GeneratePromptApiSnippetDialog>
      ))}
    </VStack>
  );
}

function UpdatedInfo({
  author,
  updatedAt,
}: {
  author?: { name: string } | null;
  updatedAt: Date;
}) {
  return (
    <Text fontSize="xs" color="gray.500" _dark={{ color: "gray.400" }}>
      updated {formatTimeAgo(updatedAt.getTime(), "dd/MMM HH:mm", 24 * 30)} by{" "}
      <Text as="span" fontWeight="medium">
        {author?.name ?? "Anonymous User"}
      </Text>
    </Text>
  );
}
