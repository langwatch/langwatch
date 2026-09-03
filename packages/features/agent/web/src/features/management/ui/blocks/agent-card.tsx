import { Box, Button, Card, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import type { Agent, AgentType } from "@langwatch/agent-contract";
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
  type LucideIcon,
  MoreVertical,
  Pencil,
  Play,
  RefreshCw,
  Trash2,
  Workflow,
} from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { agentHasDevTunnel } from "../../../../model/agent-dev-tunnel";
import { LocalTunnelBadge } from "../../../../ui/elements/local-tunnel-badge";

/**
 * The icon and the label per agent type. Both maps are keyed by the whole
 * enum, so a new agent type does not compile until it names its icon and its
 * word here, and no fallback stands in for it in silence.
 */
const agentTypeIcons: Record<AgentType, LucideIcon> = {
  signature: MessageSquare,
  code: Code,
  http: Globe,
  workflow: Workflow,
  connected: Bot,
};

const agentTypeLabels: Record<AgentType, string> = {
  signature: "Prompt",
  code: "Code",
  http: "HTTP",
  workflow: "Workflow",
  connected: "Connected",
};

/** The class that keeps a click inside the card menu out of the card click. */
export const CARD_MENU_CLASS = "js-inner-menu";

export type AgentCardShellProps = {
  /** The agent the card stands for, so a host can hand the card to an agent. */
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
 * top line, the name above the information lines, and a click anywhere on the
 * card opens the agent. A connected agent draws its own presence into
 * `trailing`, and everything else about the card stays the same.
 */
export function AgentCardShell({
  leading,
  trailing,
  menu,
  title,
  info,
  onClick,
  testId,
}: AgentCardShellProps) {
  const handleCardClick = (event: MouseEvent) => {
    if ((event.target as HTMLElement).closest(`.${CARD_MENU_CLASS}`)) return;
    onClick?.();
  };

  return (
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
  );
}

/** The three-dot button that opens the actions of a card. */
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
        <MoreVertical aria-hidden="true" size={16} />
      </Button>
    </Menu.Trigger>
  );
}

/** The mark at the top left of a card: one icon in its tile. */
export function AgentCardIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <Box bg="blue.subtle" padding={1} borderRadius="md">
      <Icon aria-hidden="true" size={18} color="var(--chakra-colors-blue-fg)" />
    </Box>
  );
}

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
  /** Runs one scripted scenario against the agent and opens the run. */
  onTest?: () => void;
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
  onTest,
}: AgentCardProps) {
  const isCopiedAgent = Boolean(agent.copiedFromAgentId);
  const hasCopies = (agent.copyCount ?? 0) > 0;

  return (
    <AgentCardShell
      agentId={agent.id}
      agentName={agent.name}
      testId={`agent-card-${agent.id}`}
      onClick={onClick}
      leading={<AgentCardIcon icon={agentTypeIcons[agent.type] ?? Bot} />}
      menu={
        (onEdit || onDelete || onTest) && (
          <Menu.Root>
            <AgentCardMenuTrigger agentName={agent.name} />
            <Menu.Content className={CARD_MENU_CLASS} portalled={false}>
              {onEdit && (
                <Menu.Item value="edit" onClick={onEdit}>
                  <Pencil aria-hidden="true" size={14} /> Edit
                </Menu.Item>
              )}
              {onTest && (
                <Menu.Item value="test" onClick={onTest} data-testid={`agent-test-${agent.id}`}>
                  <Play aria-hidden="true" size={14} /> Test agent
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
          {agentTypeLabels[agent.type]} • {updatedAtLabel}
        </Text>
      }
    />
  );
}
