import type { Agent, AgentPersonView, AgentType } from "@langwatch/agent-contract";
import type { WireOf } from "@langwatch/api/web";
import { Menu } from "@langwatch/design-system/menu";
import { Badge, Box, Button, HStack } from "@langwatch/design-system/primitives";
import { ResourceTile } from "@langwatch/design-system/resource-tile";
import {
  ArrowUp,
  Bot,
  Clock,
  Code,
  Copy,
  ExternalLink,
  Globe,
  MessageSquare,
  Mic,
  type LucideIcon,
  MoreVertical,
  Pencil,
  Play,
  RefreshCw,
  Trash2,
  Workflow,
} from "lucide-react";
import type { ReactNode } from "react";

import { agentHasDevTunnel } from "../../model/agent-dev-tunnel.ts";
import { LocalTunnelBadge } from "../elements/local-tunnel-badge.tsx";

/** Both maps are exhaustive, so new agent types must define their icon and label. */
export const agentTypeIcons: Record<AgentType, LucideIcon> = {
  signature: MessageSquare,
  code: Code,
  http: Globe,
  workflow: Workflow,
  connected: Bot,
  voice: Mic,
};

export const agentTypeLabels: Record<AgentType, string> = {
  signature: "Prompt",
  code: "Code",
  http: "HTTP",
  workflow: "Workflow",
  connected: "Connected",
  voice: "Voice agent",
};

/** The class that keeps a click inside the card menu out of the card click. */
export const CARD_MENU_CLASS = "js-inner-menu";

export type AgentCardShellProps = {
  /** The agent the card stands for, so a host can hand the card to an agent. */
  agentId: string;
  /** The mark at the top left: the icon of the kind of agent. */
  leading: ReactNode;
  /** What sits on the top right beside the menu, such as the presence. */
  trailing?: ReactNode;
  /** The three-dot menu at the top right, when the card offers actions. */
  menu?: ReactNode;
  /** The agent's name, and nothing else. */
  title: string;
  /** What sits beside the name below it: the environment, a local tunnel, a scope. */
  badges?: ReactNode;
  /** The short line under the name. */
  meta: ReactNode;
  onClick?: () => void;
  testId: string;
};

export function AgentCardShell({
  leading,
  trailing,
  menu,
  title,
  badges,
  meta,
  onClick,
  testId,
}: AgentCardShellProps) {
  return (
    <ResourceTile
      icon={leading}
      title={title}
      meta={meta}
      badges={badges}
      menu={
        (trailing || menu) && (
          <HStack gap={2}>
            {trailing}
            {menu}
          </HStack>
        )
      }
      opener={<button type="button" aria-label={title} onClick={onClick} />}
      data-testid={testId}
    />
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
  /** The list rows carry the latest version number and the creator beside the agent. */
  agent: WireOf<Agent> & { version?: number | null; createdBy?: AgentPersonView | null };
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
  /** Opens the browser call panel — the voice agent equivalent of Test. */
  onTalkToIt?: () => void;
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
  onTalkToIt,
}: AgentCardProps) {
  const isCopiedAgent = Boolean(agent.copiedFromAgentId);
  const hasCopies = (agent.copyCount ?? 0) > 0;

  return (
    <AgentCardShell
      agentId={agent.id}
      testId={`agent-card-${agent.id}`}
      onClick={onClick}
      leading={<AgentCardIcon icon={agentTypeIcons[agent.type] ?? Bot} />}
      menu={
        (onEdit || onDelete || onTest || onTalkToIt) && (
          <Menu.Root>
            <AgentCardMenuTrigger agentName={agent.name} />
            <Menu.Content className={CARD_MENU_CLASS}>
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
              {onTalkToIt && (
                <Menu.Item
                  value="talk-to-it"
                  onClick={onTalkToIt}
                  data-testid={`agent-talk-${agent.id}`}
                >
                  <Mic aria-hidden="true" size={14} /> Talk to it
                </Menu.Item>
              )}
              {agent.type === "workflow" && onOpenWorkflow && (
                <Menu.Item value="open-workflow" onClick={onOpenWorkflow}>
                  <ExternalLink aria-hidden="true" size={14} /> Open Workflow
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
                <Menu.Item value="delete" color="red.fg" onClick={onDelete}>
                  <Trash2 aria-hidden="true" size={14} /> Delete
                </Menu.Item>
              )}
            </Menu.Content>
          </Menu.Root>
        )
      }
      title={agent.name}
      badges={
        (agentHasDevTunnel(agent) || agent.version) && (
          <>
            {agent.version ? (
              <Badge size="xs" variant="subtle" data-testid={`agent-version-${agent.id}`}>
                v{agent.version}
              </Badge>
            ) : null}
            {agentHasDevTunnel(agent) && <LocalTunnelBadge />}
          </>
        )
      }
      meta={[
        agentTypeLabels[agent.type],
        agent.createdBy?.name ? `Created by ${agent.createdBy.name}` : null,
        updatedAtLabel,
      ]
        .filter(Boolean)
        .join(" • ")}
    />
  );
}
