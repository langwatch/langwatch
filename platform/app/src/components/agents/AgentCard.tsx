import {
  Box,
  Button,
  Card,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  ArrowUp,
  Bot,
  Cable,
  Code,
  Copy,
  ExternalLink,
  Globe,
  type LucideIcon,
  MessageSquare,
  MoreVertical,
  Play,
  RefreshCw,
  Workflow,
} from "lucide-react";
import type { ReactNode } from "react";
import { LuClock, LuPencil, LuTrash2 } from "react-icons/lu";
import { LangyContextTarget } from "~/features/langy/components/LangyContextTarget";
import { agentContextChip } from "~/features/langy/logic/langyContextChips";
import type { TypedAgent } from "~/server/agents/agent.repository";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { Menu } from "../ui/menu";
import { agentHasDevTunnel, LocalTunnelBadge } from "./LocalTunnelBadge";

const agentTypeIcons: Record<string, LucideIcon> = {
  signature: MessageSquare,
  code: Code,
  http: Globe,
  workflow: Workflow,
  connected: Cable,
};

const agentTypeLabels: Record<string, string> = {
  signature: "Prompt",
  code: "Code",
  http: "HTTP",
  workflow: "Workflow",
  connected: "Connected",
};

/** The class that keeps a click inside the card menu out of the card click. */
export const CARD_MENU_CLASS = "js-inner-menu";

export type AgentCardShellProps = {
  /** The agent the card stands for, so Langy can be handed the card. */
  agentId: string;
  agentName: string;
  /** The mark at the top left: the icon of the kind of agent. */
  leading: ReactNode;
  /** What sits on the top right beside the menu, such as the presence. */
  trailing?: ReactNode;
  /** The three-dot menu at the top right, when the card offers actions. */
  menu?: ReactNode;
  /** The name line, with whatever sits beside the name. */
  title: ReactNode;
  /** The short lines under the name. */
  info: ReactNode;
  onClick?: () => void;
  testId: string;
};

/**
 * The card every agent of the agents page is drawn in.
 *
 * One size and one layout for every kind of agent: a mark and a menu on the
 * top line, the name above the information lines, and a click anywhere on
 * the card opens the agent.
 */
export function AgentCardShell({
  agentId,
  agentName,
  leading,
  trailing,
  menu,
  title,
  info,
  onClick,
  testId,
}: AgentCardShellProps) {
  const handleCardClick = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest(`.${CARD_MENU_CLASS}`)) return;
    onClick?.();
  };

  return (
    // Armed, the card can be handed to Langy; its own click (open the agent)
    // is untouched, and with Langy closed this renders the card as it is.
    <LangyContextTarget target={agentContextChip({ agentId, name: agentName })}>
      <Card.Root
        variant="elevated"
        onClick={handleCardClick}
        cursor="pointer"
        height="142px"
        transition="all 0.2s ease-in-out"
        data-testid={testId}
      >
        <Card.Body padding={4}>
          <VStack align="start" gap={2} height="full" width="full" minWidth={0}>
            <HStack width="full" gap={2}>
              {leading}
              <Spacer />
              {trailing}
              {menu}
            </HStack>

            <Spacer />

            {title}

            {info}
          </VStack>
        </Card.Body>
      </Card.Root>
    </LangyContextTarget>
  );
}

/**
 * The three-dot button that opens the actions of a card.
 *
 * The menu content is portalled, so it floats above the card and its
 * neighbours instead of being cut by the card.
 */
export function AgentCardMenuTrigger({ agentName }: { agentName: string }) {
  return (
    <Menu.Trigger asChild>
      <Button
        size="xs"
        variant="ghost"
        className={CARD_MENU_CLASS}
        aria-label={`Actions for ${agentName}`}
        onClick={(event) => event.stopPropagation()}
      >
        <MoreVertical size={16} />
      </Button>
    </Menu.Trigger>
  );
}

export function AgentCardIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <Box bg="blue.subtle" padding={1} borderRadius="md">
      <Icon size={18} color="var(--chakra-colors-blue-fg)" />
    </Box>
  );
}

function AgentTypeIcon({ type }: { type: string }) {
  return <AgentCardIcon icon={agentTypeIcons[type] ?? Bot} />;
}

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
  /** Runs one scripted scenario against the agent and opens the run. */
  onTest?: () => void;
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
  onTest,
}: AgentCardProps) {
  const typeLabel = agentTypeLabels[agent.type] ?? agent.type;

  const isCopiedAgent = !!agent.copiedFromAgentId;
  const hasCopies = (agent._count?.copiedAgents ?? 0) > 0;

  return (
    <AgentCardShell
      agentId={agent.id}
      agentName={agent.name}
      onClick={onClick}
      testId={`agent-card-${agent.id}`}
      leading={<AgentTypeIcon type={agent.type} />}
      menu={
        (onEdit || onDelete || onTest) && (
          <Menu.Root>
            <AgentCardMenuTrigger agentName={agent.name} />
            <Menu.Content className={CARD_MENU_CLASS}>
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
              {onTest && (
                <Menu.Item
                  value="test"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTest();
                  }}
                  data-testid={`agent-test-${agent.id}`}
                >
                  <Play size={14} />
                  Test agent
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
        )
      }
      title={
        <HStack gap={2}>
          <Text color="fg.muted" fontSize="sm" fontWeight={500}>
            {agent.name}
          </Text>
          {agentHasDevTunnel(agent) && <LocalTunnelBadge />}
        </HStack>
      }
      info={
        <Text color="fg.subtle" fontSize="12px">
          {typeLabel} • {formatTimeAgo(new Date(agent.updatedAt).getTime())}
        </Text>
      }
    />
  );
}
