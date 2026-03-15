import { Box, Card, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import {
  ArrowUp,
  Bot,
  Code,
  Copy,
  ExternalLink,
  Globe,
  MessageSquare,
  MoreVertical,
  RefreshCw,
  Workflow,
} from "lucide-react";
import { LuClock, LuPencil, LuTrash2 } from "react-icons/lu";
import type { TypedAgent } from "~/server/agents/agent.repository";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { Menu } from "../ui/menu";


const agentTypeIcons: Record<string, typeof MessageSquare> = {
  signature: MessageSquare,
  code: Code,
  http: Globe,
  workflow: Workflow,
};

const agentTypeLabels: Record<string, string> = {
  signature: "Prompt",
  code: "Code",
  http: "HTTP",
  workflow: "Workflow",
};

export type AgentCardProps = {
  agent: TypedAgent;
  onClick?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onOpenWorkflow?: () => void;
  onReplicate?: () => void;
  onPushToCopies?: () => void;
  onSyncFromSource?: () => void;
  onViewHistory?: () => void;
};

export function AgentCard({
  agent,
  onClick,
  onEdit,
  onDelete,
  onOpenWorkflow,
  onReplicate,
  onPushToCopies,
  onSyncFromSource,
  onViewHistory,
}: AgentCardProps) {
  const Icon = agentTypeIcons[agent.type] ?? Bot;
  const typeLabel = agentTypeLabels[agent.type] ?? agent.type;

  const isCopiedAgent = !!agent.copiedFromAgentId;
  const hasCopies = (agent._count?.copiedAgents ?? 0) > 0;

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't trigger if clicking within menu
    const target = e.target as HTMLElement;
    if (target.closest(".js-inner-menu")) return;
    onClick?.();
  };

  return (
    <Card.Root
      variant="elevated"
      onClick={handleCardClick}
      cursor="pointer"
      height="142px"
      transition="all 0.2s ease-in-out"
      data-testid={`agent-card-${agent.id}`}
    >
      <Card.Body padding={4}>
        <VStack align="start" gap={2} height="full">
          {/* Top row: Icon and menu */}
          <HStack width="full">
            <Box bg="blue.subtle" padding={1} borderRadius="md">
              <Icon size={18} color="var(--chakra-colors-blue-fg)" />
            </Box>
            <Spacer />
            {(onEdit || onDelete) && (
              <Menu.Root>
                <Menu.Trigger
                  className="js-inner-menu"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical size={16} />
                </Menu.Trigger>
                <Menu.Content className="js-inner-menu" portalled={false}>
                  {onEdit && (
                    <Menu.Item
                      value="edit"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit();
                      }}
                    >
                      <LuPencil size={14} />
                      Edit
                    </Menu.Item>
                  )}
                  {agent.type === "workflow" && onOpenWorkflow && (
                    <Menu.Item
                      value="open-workflow"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenWorkflow();
                      }}
                      data-testid={`agent-open-workflow-${agent.id}`}
                    >
                      <ExternalLink size={14} />
                      Open Workflow
                    </Menu.Item>
                  )}
                  {isCopiedAgent && onSyncFromSource && (
                    <Menu.Item
                      value="sync"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSyncFromSource();
                      }}
                    >
                      <RefreshCw size={14} /> Update from source
                    </Menu.Item>
                  )}
                  {hasCopies && onPushToCopies && (
                    <Menu.Item
                      value="push"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPushToCopies();
                      }}
                    >
                      <ArrowUp size={14} /> Push to replicas
                    </Menu.Item>
                  )}
                  {onReplicate && (
                    <Menu.Item
                      value="replicate"
                      onClick={(e) => {
                        e.stopPropagation();
                        onReplicate();
                      }}
                    >
                      <Copy size={14} /> Replicate to another project
                    </Menu.Item>
                  )}
                  {onViewHistory && (
                    <Menu.Item
                      value="view-history"
                      onClick={(e) => {
                        e.stopPropagation();
                        onViewHistory();
                      }}
                    >
                      <LuClock size={14} />
                      View history
                    </Menu.Item>
                  )}
                  {onDelete && (
                    <Menu.Item
                      value="delete"
                      color="red.500"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                      }}
                    >
                      <LuTrash2 size={14} />
                      Delete
                    </Menu.Item>
                  )}
                </Menu.Content>
              </Menu.Root>
            )}
          </HStack>

          <Spacer />

          {/* Name */}
          <Text color="fg.muted" fontSize="sm" fontWeight={500}>
            {agent.name}
          </Text>

          {/* Metadata */}
          <Text color="fg.subtle" fontSize="12px">
            {typeLabel} • {formatTimeAgo(new Date(agent.updatedAt).getTime())}
          </Text>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
