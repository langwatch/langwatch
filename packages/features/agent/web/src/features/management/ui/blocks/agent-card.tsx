import { Box, Card, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import type { Agent } from "@langwatch/agent-contract";
import { Menu } from "@langwatch/design-system/menu";
import {
  ArrowUp,
  Bot,
  Clock,
  Code,
  Copy,
  ExternalLink,
  Globe,
  MessageSquare,
  MoreVertical,
  Pencil,
  RefreshCw,
  Trash2,
  Workflow,
} from "lucide-react";
import type { MouseEvent } from "react";
import { agentHasDevTunnel } from "../../../../model/agent-dev-tunnel";
import { LocalTunnelBadge } from "../../../../ui/elements/local-tunnel-badge";

const agentTypeIcons = {
  signature: MessageSquare,
  code: Code,
  http: Globe,
  workflow: Workflow,
} as const;

const agentTypeLabels = {
  signature: "Prompt",
  code: "Code",
  http: "HTTP",
  workflow: "Workflow",
} as const;

export type AgentCardProps = {
  agent: Agent;
  updatedAtLabel: string;
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
  updatedAtLabel,
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
  const isCopiedAgent = Boolean(agent.copiedFromAgentId);
  const hasCopies = (agent.copyCount ?? 0) > 0;
  const handleCardClick = (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest(".js-inner-menu")) return;
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
          <HStack width="full">
            <Box bg="blue.subtle" padding={1} borderRadius="md">
              <Icon aria-hidden="true" size={18} color="var(--chakra-colors-blue-fg)" />
            </Box>
            <Spacer />
            {(onEdit || onDelete) && (
              <Menu.Root>
                <Menu.Trigger
                  aria-label={`Actions for ${agent.name}`}
                  className="js-inner-menu"
                  onClick={(event) => event.stopPropagation()}
                >
                  <MoreVertical aria-hidden="true" size={16} />
                </Menu.Trigger>
                <Menu.Content className="js-inner-menu" portalled={false}>
                  {onEdit && (
                    <Menu.Item value="edit" onClick={onEdit}>
                      <Pencil aria-hidden="true" size={14} /> Edit
                    </Menu.Item>
                  )}
                  {agent.type === "workflow" && onOpenWorkflow && (
                    <Menu.Item value="open-workflow" onClick={onOpenWorkflow}>
                      <ExternalLink aria-hidden="true" size={14} /> Open workflow
                    </Menu.Item>
                  )}
                  {isCopiedAgent && onSyncFromSource && (
                    <Menu.Item value="sync" onClick={onSyncFromSource}>
                      <RefreshCw aria-hidden="true" size={14} /> Update from source
                    </Menu.Item>
                  )}
                  {hasCopies && onPushToCopies && (
                    <Menu.Item value="push" onClick={onPushToCopies}>
                      <ArrowUp aria-hidden="true" size={14} /> Push to replicas
                    </Menu.Item>
                  )}
                  {onReplicate && (
                    <Menu.Item value="replicate" onClick={onReplicate}>
                      <Copy aria-hidden="true" size={14} /> Replicate to another project
                    </Menu.Item>
                  )}
                  {onViewHistory && (
                    <Menu.Item value="view-history" onClick={onViewHistory}>
                      <Clock aria-hidden="true" size={14} /> View history
                    </Menu.Item>
                  )}
                  {onDelete && (
                    <Menu.Item value="delete" color="red.500" onClick={onDelete}>
                      <Trash2 aria-hidden="true" size={14} /> Delete
                    </Menu.Item>
                  )}
                </Menu.Content>
              </Menu.Root>
            )}
          </HStack>
          <Spacer />
          <HStack gap={2}>
            <Text color="fg.muted" fontSize="sm" fontWeight={500}>
              {agent.name}
            </Text>
            {agentHasDevTunnel(agent) && <LocalTunnelBadge />}
          </HStack>
          <Text color="fg.subtle" fontSize="12px">
            {agentTypeLabels[agent.type]} • {updatedAtLabel}
          </Text>
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
