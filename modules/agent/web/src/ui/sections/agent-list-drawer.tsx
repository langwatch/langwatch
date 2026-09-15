import { Alert, Box, Button, Heading, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { formatDistanceToNow, toEpochMs } from "@langwatch/time";
import { Bot, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  useAgentListArchive,
  type AgentListArchiveOptions,
} from "../../behavior/use-agent-list-archive.ts";
import { Drawer } from "@langwatch/design-system/studio-drawer";
import { Menu } from "@langwatch/design-system/menu";
import type { AgentWithFields as StoredAgentWithFields } from "@langwatch/agent-contract";
import type { WireOf } from "@langwatch/api/web";
import { AgentArchiveDialog } from "../blocks/agent-archive-dialog.tsx";
import { agentTypeIcons, agentTypeLabels } from "../blocks/agent-card.tsx";

type AgentWithFields = WireOf<StoredAgentWithFields>;
export interface AgentListDrawerProps extends AgentListArchiveOptions {
  open: boolean;
  items: AgentWithFields[];
  isLoading: boolean;
  errorMessage?: string;
  onClose(): void;
  onSelect(agent: AgentWithFields): void;
  onEdit(agent: AgentWithFields): void;
  onCreateNew(): void;
}

export function AgentListDrawer(props: AgentListDrawerProps) {
  const isOpen = props.open;
  const {
    agentToDelete,
    setAgentToDelete,
    related,
    isLoadingRelated,
    isArchiving,
    confirmDeleteAgent,
  } = useAgentListArchive(props);

  return (
    <>
      <Drawer.Root
        open={isOpen}
        onOpenChange={({ open }) => !open && props.onClose()}
        size="md"
        modal={false}
      >
        <Drawer.Content bg="bg">
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <HStack gap={2} justify="space-between" width="full">
              <Heading>Choose Agent</Heading>
              <Button
                size="sm"
                colorPalette="blue"
                onClick={props.onCreateNew}
                data-testid="new-agent-button"
              >
                <Plus size={16} />
                New Agent
              </Button>
            </HStack>
          </Drawer.Header>
          <Drawer.Body display="flex" flexDirection="column" overflow="hidden" padding={0}>
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
                <AgentListContent {...props} onArchiveRequested={setAgentToDelete} />
              </VStack>
            </VStack>
          </Drawer.Body>
          <Drawer.Footer borderTopWidth="1px" borderColor="border">
            <Button variant="outline" onClick={props.onClose}>
              Cancel
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer.Root>

      <AgentArchiveDialog
        open={Boolean(agentToDelete)}
        onClose={() => setAgentToDelete(null)}
        onConfirm={() => void confirmDeleteAgent()}
        isLoading={isArchiving}
        isLoadingRelated={isLoadingRelated}
        agentName={agentToDelete?.name ?? ""}
        relatedWorkflow={related?.workflow ?? null}
      />
    </>
  );
}

function AgentListContent(
  props: AgentListDrawerProps & { onArchiveRequested(agent: AgentWithFields): void },
) {
  if (props.errorMessage) {
    return (
      <Alert.Root status="error">
        <Alert.Content>{props.errorMessage}</Alert.Content>
      </Alert.Root>
    );
  }
  if (props.isLoading)
    return (
      <HStack justify="center" paddingY={8}>
        <Spinner size="md" />
      </HStack>
    );
  if (props.items.length === 0) return <EmptyState onCreateNew={props.onCreateNew} />;

  return props.items.map((agent) => (
    <AgentListCard
      key={agent.id}
      agent={agent}
      onClick={() => {
        props.onSelect(agent);
        props.onClose();
      }}
      onEdit={() => props.onEdit(agent)}
      onDelete={() => props.onArchiveRequested(agent)}
    />
  ));
}

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
      <Button colorPalette="blue" onClick={onCreateNew} data-testid="create-first-agent-button">
        <Plus size={16} />
        Create your first agent
      </Button>
    </VStack>
  );
}

type AgentListCardProps = {
  agent: AgentWithFields;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

function AgentListCard({ agent, onClick, onEdit, onDelete }: AgentListCardProps) {
  const Icon = agentTypeIcons[agent.type];
  const typeLabel = agentTypeLabels[agent.type];
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
      cursor="pointer"
      onClick={onClick}
      data-testid={`agent-card-${agent.id}`}
    >
      <HStack gap={3}>
        <Box display="flex" alignItems="center" gap={3} flex={1} textAlign="left">
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
                {formatDistanceToNow(toEpochMs(agent.updatedAt), {
                  addSuffix: true,
                })}
              </Text>
            </HStack>
          </VStack>
        </Box>

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
