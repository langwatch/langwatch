import {
  Box,
  Button,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Bot, Code, MessageSquare, Plus, Workflow } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { Drawer } from "~/components/ui/drawer";
import { useDrawer, getComplexProps } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { TypedAgent } from "~/server/agents/agent.repository";

export type AgentListDrawerProps = {
  open?: boolean;
  onClose?: () => void;
  onSelect?: (agent: TypedAgent) => void;
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

  const onClose = props.onClose ?? closeDrawer;
  const onSelect = props.onSelect ?? (complexProps.onSelect as AgentListDrawerProps["onSelect"]);
  const onCreateNew = props.onCreateNew ?? (() => openDrawer("agentTypeSelector"));
  const isOpen = props.open !== false && props.open !== undefined;

  const agentsQuery = api.agents.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && isOpen }
  );

  const handleSelectAgent = (agent: TypedAgent) => {
    onSelect?.(agent);
    onClose();
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
            <HStack gap={2}>
              <Bot size={20} />
              <Text fontSize="xl" fontWeight="semibold">
                Choose Agent
              </Text>
            </HStack>
            <Button
              size="sm"
              colorScheme="blue"
              onClick={onCreateNew}
              data-testid="new-agent-button"
            >
              <Plus size={16} />
              New Agent
            </Button>
          </HStack>
        </Drawer.Header>
        <Drawer.Body display="flex" flexDirection="column" overflow="hidden" padding={0}>
          <VStack gap={4} align="stretch" flex={1} overflow="hidden">
            <Text color="gray.600" fontSize="sm" paddingX={6} paddingTop={4}>
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
                  />
                ))
              )}
            </VStack>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer borderTopWidth="1px" borderColor="gray.200">
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
      <Box
        padding={4}
        borderRadius="full"
        bg="gray.100"
        color="gray.500"
      >
        <Bot size={32} />
      </Box>
      <VStack gap={1}>
        <Text fontWeight="medium" color="gray.700">
          No agents yet
        </Text>
        <Text fontSize="sm" color="gray.500">
          Create your first agent to get started
        </Text>
      </VStack>
      <Button
        colorScheme="blue"
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
};

const agentTypeLabels: Record<string, string> = {
  signature: "Prompt",
  code: "Code",
  workflow: "Workflow",
};

type AgentCardProps = {
  agent: TypedAgent;
  onClick: () => void;
};

function AgentCard({ agent, onClick }: AgentCardProps) {
  const Icon = agentTypeIcons[agent.type] ?? Bot;
  const typeLabel = agentTypeLabels[agent.type] ?? agent.type;

  return (
    <Box
      as="button"
      onClick={onClick}
      padding={4}
      borderRadius="md"
      border="1px solid"
      borderColor="gray.200"
      bg="white"
      textAlign="left"
      width="full"
      _hover={{ borderColor: "blue.400", bg: "blue.50" }}
      transition="all 0.15s"
      data-testid={`agent-card-${agent.id}`}
    >
      <HStack gap={3}>
        <Box color="blue.500">
          <Icon size={20} />
        </Box>
        <VStack align="start" gap={0} flex={1}>
          <Text fontWeight="medium" fontSize="sm">
            {agent.name}
          </Text>
          <HStack gap={2} fontSize="xs" color="gray.500">
            <Text>{typeLabel}</Text>
            <Text>•</Text>
            <Text>
              Updated {formatDistanceToNow(new Date(agent.updatedAt), { addSuffix: true })}
            </Text>
          </HStack>
        </VStack>
      </HStack>
    </Box>
  );
}
