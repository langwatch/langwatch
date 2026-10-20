import type { AgentWithFields as StoredAgentWithFields } from "@langwatch/agent-contract";
import type { WireOf } from "@langwatch/api/web";
import { Drawer } from "@langwatch/design-system/drawer";
import { Menu } from "@langwatch/design-system/menu";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Alert, Box, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import { useProductAccent } from "@langwatch/design-system/use-product-accent";
import { formatDistanceToNow, toEpochMs } from "@langwatch/time";
import { Bot, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  useAgentListArchive,
  type AgentListArchiveOptions,
} from "../../behavior/use-agent-list-archive.ts";
import { AgentArchiveDialog } from "../blocks/agent-archive-dialog.tsx";
import { agentTypeIcons, agentTypeLabels } from "../blocks/agent-card.tsx";

const AGENTS_DOCS_HREF = "https://langwatch.ai/docs/agent-testing/targets";

type AgentWithFields = WireOf<StoredAgentWithFields>;
/** What a caller hands agent's list drawer: the agents, as the browser receives them. */
export type AgentListDrawerProps = AgentListArchiveOptions & {
  open: boolean;
  items: AgentWithFields[];
  isLoading: boolean;
  errorMessage?: string;
  onClose: () => void;
  onSelect(agent: AgentWithFields): void;
  onEdit(agent: AgentWithFields): void;
  onCreateNew: () => void;
};

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
      <Drawer
        open={isOpen}
        onClose={props.onClose}
        size="md"
        title="Choose Agent"
        headerAction={{
          label: "New Agent",
          icon: <Plus size={14} />,
          onClick: props.onCreateNew,
          "data-testid": "new-agent-button",
        }}
        footer={{ cancel: { onClick: props.onClose } }}
      >
        <VStack gap={4} align="stretch">
          <Text color="fg.muted" fontSize="sm">
            Select an existing agent or create a new one.
          </Text>
          <VStack gap={2} align="stretch">
            <AgentListContent {...props} onArchiveRequested={setAgentToDelete} />
          </VStack>
        </VStack>
      </Drawer>

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
  if (props.isLoading) return <SkeletonRows rows={4} />;
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
  const accent = useProductAccent();
  return (
    <NoDataInfoBlock
      size="inline"
      bordered={false}
      icon={<Bot size={24} />}
      title="No agents yet"
      description="Create your first agent to get started"
      primaryAction={
        <Button
          colorPalette={accent.colorPalette}
          variant="solid"
          onClick={onCreateNew}
          data-testid="create-first-agent-button"
        >
          <Plus size={16} />
          Create your first agent
        </Button>
      }
      next={[{ kind: "docs", label: "How agents are used", href: AGENTS_DOCS_HREF }]}
    />
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
