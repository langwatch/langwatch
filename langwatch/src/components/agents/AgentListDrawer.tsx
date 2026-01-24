import {
  Box,
  Button,
  Heading,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { formatDistanceToNow } from "date-fns";
import {
  Bot,
  Code,
  Globe,
  MessageSquare,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
  Workflow,
} from "lucide-react";
import { useState } from "react";

import { Drawer } from "~/components/ui/drawer";
import { Menu } from "~/components/ui/menu";
import { toaster } from "~/components/ui/toaster";
import { getComplexProps, useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { TypedAgent } from "~/server/agents/agent.repository";
import { api } from "~/utils/api";

export type AgentListDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelect?: (agent: TypedAgent) => void;
  onEdit?: (agent: TypedAgent) => void;
  onCreateNew?: () => void;
};

/**
 * Drawer for selecting an existing agent or creating a new one.
 * Features:
 * - Shows list of saved agents
 * - Empty state with create CTA
 * - "New Agent" button at top
 * - Reusable across the app via useDrawer
 */
export function AgentListDrawer(props: AgentListDrawerProps) {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer, openDrawer } = useDrawer();
  const complexProps = getComplexProps();
  const utils = api.useContext();

  const onClose = props.onClose ?? closeDrawer;
  const onSelect =
    props.onSelect ??
    (complexProps.onSelect as AgentListDrawerProps["onSelect"]);
  const onEdit =
    props.onEdit ?? (complexProps.onEdit as AgentListDrawerProps["onEdit"]);
  const onCreateNew =
    props.onCreateNew ?? (() => openDrawer("agentTypeSelector"));
  const isOpen = props.open !== false && props.open !== undefined;

  const agentsQuery = api.agents.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && isOpen },
  );

  const deleteMutation = api.agents.delete.useMutation({
    onSuccess: () => {
      void utils.agents.getAll.invalidate({ projectId: project?.id ?? "" });
      toaster.create({
        title: "Agent deleted",
        type: "success",
        meta: { closable: true },
      });
    },
    onError: (error) => {
      toaster.create({
        title: "Error deleting agent",
        description: error.message,
        type: "error",
        meta: { closable: true },
      });
    },
  });

  const handleSelectAgent = (agent: TypedAgent) => {
    onSelect?.(agent);
    onClose();
  };

  const handleEditAgent = (agent: TypedAgent) => {
    if (onEdit) {
      onEdit(agent);
    } else {
      // Default: open appropriate editor drawer based on agent type
      if (agent.type === "http") {
        openDrawer("agentHttpEditor", { agentId: agent.id });
      } else {
        openDrawer("agentCodeEditor", { agentId: agent.id });
      }
    }
  };

  const handleDeleteAgent = (agent: TypedAgent) => {
    if (
      window.confirm(
        `Are you sure you want to delete "${agent.name}"? This action cannot be undone.`,
      )
    ) {
      deleteMutation.mutate({
        id: agent.id,
        projectId: project?.id ?? "",
      });
    }
  };

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={({ open }) => !open && onClose()}
      size="md"
    >
      <Drawer.Content>
        <Drawer.CloseTrigger />
        <Drawer.Header>
          <HStack gap={2} justify="space-between" width="full">
            <Heading>Choose Agent</Heading>
            <Button
              size="sm"
              colorPalette="blue"
              onClick={onCreateNew}
              data-testid="new-agent-button"
            >
              <Plus size={16} />
              New Agent
            </Button>
          </HStack>
        </Drawer.Header>
        <Drawer.Body
          display="flex"
          flexDirection="column"
          overflow="hidden"
          padding={0}
        >
          <VStack gap={4} align="stretch" flex={1} overflow="hidden">
            <Text color="fg.muted" fontSize="sm" paddingX={6} paddingTop={4}>
              Select an existing agent or create a new one.
            </Text>

            {/* Agent list - scrollable */}
            <VStack
              gap={2}
              align="stretch"
              flex={1}
              overflowY="auto"
              paddingX={6}
              paddingBottom={4}
            >
              {agentsQuery.isLoading ? (
                <HStack justify="center" paddingY={8}>
                  <Spinner size="md" />
                </HStack>
              ) : agentsQuery.data?.length === 0 ? (
                <EmptyState onCreateNew={onCreateNew} />
              ) : (
                agentsQuery.data?.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    onClick={() => handleSelectAgent(agent)}
                    onEdit={() => handleEditAgent(agent)}
                    onDelete={() => handleDeleteAgent(agent)}
                  />
                ))
              )}
            </VStack>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="border">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}

// ============================================================================
// Empty State Component
// ============================================================================

function EmptyState({ onCreateNew }: { onCreateNew: () => void }) {
  return (
    <VStack paddingY={12} gap={4} textAlign="center">
      <Box padding={4} borderRadius="full" bg="bg.muted" color="fg.muted">
        <Bot size={32} />
      </Box>
      <VStack gap={1}>
        <Text fontWeight="medium" color="fg">
          No agents yet
        </Text>
        <Text fontSize="sm" color="fg.muted">
          Create your first agent to get started
        </Text>
      </VStack>
      <Button
        colorPalette="blue"
        onClick={onCreateNew}
        data-testid="create-first-agent-button"
      >
        <Plus size={16} />
        Create your first agent
      </Button>
    </VStack>
  );
}

// ============================================================================
// Agent Card Component
// ============================================================================

const agentTypeIcons: Record<string, typeof MessageSquare> = {
  signature: MessageSquare,
  code: Code,
  workflow: Workflow,
  http: Globe,
};

const agentTypeLabels: Record<string, string> = {
  signature: "Prompt",
  code: "Code",
  workflow: "Workflow",
  http: "HTTP",
};

type AgentCardProps = {
  agent: TypedAgent;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

function AgentCard({ agent, onClick, onEdit, onDelete }: AgentCardProps) {
  const Icon = agentTypeIcons[agent.type] ?? Bot;
  const typeLabel = agentTypeLabels[agent.type] ?? agent.type;
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <Box
      position="relative"
      padding={4}
      borderRadius="md"
      border="1px solid"
      borderColor="border"
      bg="bg.panel"
      textAlign="left"
      width="full"
      _hover={{ borderColor: "blue.muted", bg: "blue.subtle" }}
      transition="all 0.15s"
      data-testid={`agent-card-${agent.id}`}
    >
      <HStack gap={3}>
        {/* Clickable area for selection */}
        <Box
          as="button"
          onClick={onClick}
          display="flex"
          alignItems="center"
          gap={3}
          flex={1}
          textAlign="left"
        >
          <Box color="blue.fg">
            <Icon size={20} />
          </Box>
          <VStack align="start" gap={0} flex={1}>
            <Text fontWeight="medium" fontSize="sm">
              {agent.name}
            </Text>
            <HStack gap={2} fontSize="xs" color="fg.muted">
              <Text>{typeLabel}</Text>
              <Text>•</Text>
              <Text>
                Updated{" "}
                {formatDistanceToNow(new Date(agent.updatedAt), {
                  addSuffix: true,
                })}
              </Text>
            </HStack>
          </VStack>
        </Box>

        {/* Menu button */}
        <Menu.Root
          open={menuOpen}
          onOpenChange={(e) => setMenuOpen(e.open)}
          positioning={{ placement: "bottom-end" }}
        >
          <Menu.Trigger asChild>
            <Button
              variant="ghost"
              size="xs"
              padding={1}
              minWidth="auto"
              onClick={(e) => {
                e.stopPropagation();
              }}
              data-testid={`agent-menu-${agent.id}`}
            >
              <MoreVertical size={16} />
            </Button>
          </Menu.Trigger>
          <Menu.Content minWidth="160px">
            <Menu.Item
              value="edit"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onEdit();
              }}
            >
              <HStack gap={2}>
                <Pencil size={14} />
                <Text>Edit Agent</Text>
              </HStack>
            </Menu.Item>
            <Box borderTopWidth="1px" borderColor="border" my={1} />
            <Menu.Item
              value="delete"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onDelete();
              }}
            >
              <HStack gap={2} color="red.fg">
                <Trash2 size={14} />
                <Text>Delete Agent</Text>
              </HStack>
            </Menu.Item>
          </Menu.Content>
        </Menu.Root>
      </HStack>
    </Box>
  );
}
