import type { AgentHistoryEntry } from "@langwatch/agent-contract";
import { Drawer } from "@langwatch/design-system/drawer";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Box, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import {
  ArrowUp,
  Bot,
  Copy,
  Edit,
  History,
  type LucideIcon,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { AgentClient } from "../../model/agent-client.ts";

const ACTION_META = {
  "agents.create": { label: "Created", icon: Bot },
  "agents.update": { label: "Updated", icon: Edit },
  "agents.delete": { label: "Deleted", icon: Trash2 },
  "agents.cascadeArchive": { label: "Archived", icon: Trash2 },
  "agents.copy": { label: "Replicated", icon: Copy },
  "workflow.copyAgent": { label: "Replicated", icon: Copy },
  "agents.pushToCopies": { label: "Pushed to replicas", icon: ArrowUp },
  "agents.syncFromSource": { label: "Synced from source", icon: RefreshCw },
} as const satisfies Record<string, { label: string; icon: LucideIcon }>;

const AGENTS_DOCS_HREF = "https://langwatch.ai/docs/agent-testing/targets";

export type AgentHistoryDrawerProps = {
  agentId: string;
  agentName: string;
  projectId: string;
  agents: AgentClient;
  onClose: () => void;
  formatCreatedAt: (createdAt: AgentHistoryEntry["createdAt"]) => string;
};

export function AgentHistoryDrawer(props: AgentHistoryDrawerProps) {
  const [entries, setEntries] = useState<AgentHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    let active = true;
    setEntries([]);
    setIsLoading(true);
    setIsError(false);

    void props.agents
      .getHistory({ agentId: props.agentId, projectId: props.projectId })
      .then((result) => active && setEntries(result))
      .catch(() => active && setIsError(true))
      .finally(() => active && setIsLoading(false));

    return () => {
      active = false;
    };
  }, [props.agentId, props.agents, props.projectId]);

  return (
    <Drawer onClose={() => props.onClose()} title={`${props.agentName} history`}>
      {isLoading && <SkeletonRows rows={4} />}
      {isError && (
        <Text role="alert" color="red.fg" textAlign="center" paddingY={8}>
          Failed to load history.
        </Text>
      )}
      {!isLoading && !isError && entries.length === 0 && (
        <NoDataInfoBlock
          size="inline"
          bordered={false}
          icon={<History size={20} />}
          title="No history recorded yet"
          description="Edits, replicas and syncs of this agent are listed here as they happen."
          next={[{ kind: "docs", label: "How agents are used", href: AGENTS_DOCS_HREF }]}
        />
      )}
      {!isLoading && !isError && entries.length > 0 && (
        <VStack gap={0} align="stretch">
          {entries.map((entry, index) => (
            <HistoryEntry
              key={entry.id}
              entry={entry}
              isLast={index === entries.length - 1}
              createdAtLabel={props.formatCreatedAt(entry.createdAt)}
            />
          ))}
        </VStack>
      )}
    </Drawer>
  );
}

function HistoryEntry({
  entry,
  isLast,
  createdAtLabel,
}: {
  entry: AgentHistoryEntry;
  isLast: boolean;
  createdAtLabel: string;
}) {
  const metadata = ACTION_META[entry.action as keyof typeof ACTION_META] ?? {
    label: entry.action,
    icon: X,
  };
  const Icon = metadata.icon;

  return (
    <HStack align="start" gap={3}>
      <VStack gap={0} align="center" flexShrink={0} width="24px">
        <Box bg="blue.subtle" borderRadius="full" padding={1} mt="0.5">
          <Icon size={12} color="var(--chakra-colors-blue-fg)" />
        </Box>
        {!isLast && <Box width="1px" flex={1} minHeight="24px" bg="border.muted" />}
      </VStack>
      <VStack align="start" gap={0} paddingBottom={4} flex={1}>
        <Text fontWeight="medium" fontSize="sm">
          {metadata.label}
        </Text>
        <Text color="fg.muted" fontSize="xs">
          {entry.user?.name ?? entry.user?.email ?? "Unknown user"} · {createdAtLabel}
        </Text>
      </VStack>
    </HStack>
  );
}
