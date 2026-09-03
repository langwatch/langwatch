import { Box, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import type { AgentHistoryEntry } from "@langwatch/agent-contract";
import { Drawer } from "@langwatch/design-system/drawer";
import { ArrowUp, Bot, Copy, Edit, type LucideIcon, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentBrowserPort } from "../../../../model/agent-browser.port";

const ACTION_META = {
  "agents.create": { label: "Created", icon: Bot },
  "agents.update": { label: "Updated", icon: Edit },
  "agents.delete": { label: "Deleted", icon: Trash2 },
  "agents.cascadeArchive": { label: "Archived", icon: Trash2 },
  "agents.copy": { label: "Replicated", icon: Copy },
  "agents.pushToCopies": { label: "Pushed to replicas", icon: ArrowUp },
  "agents.syncFromSource": { label: "Synced from source", icon: RefreshCw },
} as const satisfies Record<string, { label: string; icon: LucideIcon }>;

export type AgentHistoryDrawerProps = {
  agentId: string;
  agentName: string;
  projectId: string;
  agents: AgentBrowserPort;
  onClose: () => void;
  formatCreatedAt: (createdAt: Date) => string;
};

export function AgentHistoryDrawer(props: AgentHistoryDrawerProps) {
  const [entries, setEntries] = useState<AgentHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    let active = true;
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
    <Drawer.Root
      open
      placement="end"
      size="md"
      onOpenChange={({ open }) => !open && props.onClose()}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Text fontWeight="semibold" fontSize="lg">
            {`${props.agentName} history`}
          </Text>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          {isLoading && (
            <HStack justify="center" paddingY={8}>
              <Spinner />
            </HStack>
          )}
          {isError && (
            <Text role="alert" color="red.fg" textAlign="center" paddingY={8}>
              Failed to load history.
            </Text>
          )}
          {!isLoading && !isError && entries.length === 0 && (
            <Text color="fg.muted" textAlign="center" paddingY={8}>
              No history recorded yet.
            </Text>
          )}
          {entries.length > 0 && (
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
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
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
        <Box bg="blue.subtle" borderRadius="full" padding={1} mt="2px">
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
