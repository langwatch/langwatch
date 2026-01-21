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
import { useCallback, useState } from "react";
import {
  ArrowUp,
  Copy,
  Edit,
  MoreVertical,
  RefreshCw,
  Trash2,
} from "react-feather";
import { LuBuilding } from "react-icons/lu";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { CopyButton } from "../components/CopyButton";
import { GenerateApiSnippetButton } from "../components/GenerateApiSnippetButton";
import { LLMModelDisplay } from "../components/llmPromptConfigs/LLMModelDisplay";
import { formatTimeAgo } from "../utils/formatTimeAgo";
import { CopyPromptDialog } from "./components/CopyPromptDialog";
import { GeneratePromptApiSnippetDialog } from "./components/GeneratePromptApiSnippetDialog";
import { PushToCopiesDialog } from "./components/PushToCopiesDialog";

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
  copiedFromPromptId?: string | null;
  _count?: {
    copiedPrompts?: number;
  };
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
  const { project, hasPermission } = useOrganizationTeamProject();
  const hasPromptsViewPermission = hasPermission("prompts:view");
  const hasPromptsUpdatePermission = hasPermission("prompts:update");
  const hasPromptsDeletePermission = hasPermission("prompts:delete");
  const hasPromptsCreatePermission = hasPermission("prompts:create");

  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [pushToCopiesDialogOpen, setPushToCopiesDialogOpen] = useState(false);
  const [copyPrompt, setCopyPrompt] = useState<{
    promptId: string;
    promptName: string;
  } | null>(null);
  const [pushPrompt, setPushPrompt] = useState<{
    promptId: string;
    promptName: string;
  } | null>(null);

  const syncFromSource = api.prompts.syncFromSource.useMutation();
  const utils = api.useContext();

  const onSyncFromSource = useCallback(
    async (config: PromptListItem) => {
      if (!project || !config.copiedFromPromptId) return;

      try {
        await syncFromSource.mutateAsync({
          idOrHandle: config.id,
          projectId: project.id,
        });
        await utils.prompts.getAllPromptsForProject.invalidate();
        toaster.create({
          title: "Prompt updated",
          description: `Prompt "${
            config.handle ?? config.name ?? config.id
          }" has been updated from source.`,
          type: "success",
          meta: {
            closable: true,
          },
        });
      } catch (error) {
        toaster.create({
          title: "Error updating prompt",
          description:
            error instanceof Error ? error.message : "Please try again later.",
          type: "error",
          meta: {
            closable: true,
          },
        });
      }
    },
    [syncFromSource, project, utils],
  );

  const onPushToCopies = useCallback((config: PromptListItem) => {
    setPushPrompt({
      promptId: config.id,
      promptName: config.handle ?? config.name ?? config.id,
    });
    setPushToCopiesDialogOpen(true);
  }, []);

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
        <Text fontSize="lg" color="fg.muted" textAlign="center">
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
            cursor={hasPromptsViewPermission ? "pointer" : "default"}
            onClick={
              hasPromptsViewPermission ? () => void onEdit(config) : undefined
            }
            transition="all 0.2s"
            _hover={
              hasPromptsViewPermission
                ? {
                    transform: "translateY(-2px)",
                    shadow: "md",
                  }
                : {}
            }
            borderWidth="1px"
            borderColor="border"
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
                            color="fg.muted"
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
                      <Tooltip
                        content={
                          !hasPromptsUpdatePermission
                            ? "You need prompts:update permission to edit prompts"
                            : undefined
                        }
                        disabled={hasPromptsUpdatePermission}
                        positioning={{ placement: "right" }}
                        showArrow
                      >
                        <Menu.Item
                          value="edit"
                          onClick={(_event) => {
                            if (hasPromptsUpdatePermission) {
                              void onEdit(config);
                            }
                          }}
                          disabled={!hasPromptsUpdatePermission}
                        >
                          <Edit size={16} /> Edit prompt
                        </Menu.Item>
                      </Tooltip>
                      <Menu.Item value="generate-api-snippet">
                        <GeneratePromptApiSnippetDialog.Trigger>
                          <HStack>
                            <UnplugIcon />
                            <Text>Show API code snippet</Text>
                          </HStack>
                        </GeneratePromptApiSnippetDialog.Trigger>
                      </Menu.Item>
                      {config.copiedFromPromptId && (
                        <Tooltip
                          content={
                            !hasPromptsUpdatePermission
                              ? "You need prompts:update permission to sync from source"
                              : undefined
                          }
                          disabled={hasPromptsUpdatePermission}
                          positioning={{ placement: "right" }}
                          showArrow
                        >
                          <Menu.Item
                            value="sync"
                            onClick={
                              hasPromptsUpdatePermission
                                ? () => void onSyncFromSource(config)
                                : undefined
                            }
                            disabled={!hasPromptsUpdatePermission}
                          >
                            <RefreshCw size={16} /> Update from source
                          </Menu.Item>
                        </Tooltip>
                      )}
                      {(config._count?.copiedPrompts ?? 0) > 0 && (
                        <Tooltip
                          content={
                            !hasPromptsUpdatePermission
                              ? "You need prompts:update permission to push to replicas"
                              : undefined
                          }
                          disabled={hasPromptsUpdatePermission}
                          positioning={{ placement: "right" }}
                          showArrow
                        >
                          <Menu.Item
                            value="push"
                            onClick={
                              hasPromptsUpdatePermission
                                ? () => void onPushToCopies(config)
                                : undefined
                            }
                            disabled={!hasPromptsUpdatePermission}
                          >
                            <ArrowUp size={16} /> Push to replicas
                          </Menu.Item>
                        </Tooltip>
                      )}
                      <Tooltip
                        content={
                          !hasPromptsCreatePermission
                            ? "You need prompts:create permission to replicate prompts"
                            : undefined
                        }
                        disabled={hasPromptsCreatePermission}
                        positioning={{ placement: "right" }}
                        showArrow
                      >
                        <Menu.Item
                          value="copy"
                          onClick={
                            hasPromptsCreatePermission
                              ? () => {
                                  setCopyPrompt({
                                    promptId: config.id,
                                    promptName:
                                      config.handle ?? config.name ?? config.id,
                                  });
                                  setCopyDialogOpen(true);
                                }
                              : undefined
                          }
                          disabled={!hasPromptsCreatePermission}
                        >
                          <Copy size={16} /> Replicate to another project
                        </Menu.Item>
                      </Tooltip>
                      <Tooltip
                        content={
                          !hasPromptsDeletePermission
                            ? "You need prompts:delete permission to delete prompts"
                            : undefined
                        }
                        disabled={hasPromptsDeletePermission}
                        positioning={{ placement: "right" }}
                        showArrow
                      >
                        <Menu.Item
                          value="delete"
                          color="red.600"
                          onClick={(_event) => {
                            if (hasPromptsDeletePermission) {
                              void onDelete(config);
                            }
                          }}
                          disabled={!hasPromptsDeletePermission}
                        >
                          <Trash2 size={16} /> Delete prompt
                        </Menu.Item>
                      </Tooltip>
                    </Menu.Content>
                  </Menu.Root>
                </Box>
              </HStack>
            </Card.Header>

            <Card.Body pt={0} pb={4}>
              <Box
                bg="bg.muted"
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
                  color="fg"
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
                borderColor="border"
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
      {copyPrompt && (
        <CopyPromptDialog
          open={copyDialogOpen}
          onClose={() => {
            setCopyDialogOpen(false);
            setCopyPrompt(null);
          }}
          promptId={copyPrompt.promptId}
          promptName={copyPrompt.promptName}
        />
      )}
      {pushPrompt && (
        <PushToCopiesDialog
          open={pushToCopiesDialogOpen}
          onClose={() => {
            setPushToCopiesDialogOpen(false);
            setPushPrompt(null);
          }}
          promptId={pushPrompt.promptId}
          promptName={pushPrompt.promptName}
        />
      )}
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
    <Text fontSize="xs" color="fg.muted">
      updated {formatTimeAgo(updatedAt.getTime(), "dd/MMM HH:mm", 24 * 30)} by{" "}
      <Text as="span" fontWeight="medium">
        {author?.name ?? "Anonymous User"}
      </Text>
    </Text>
  );
}
