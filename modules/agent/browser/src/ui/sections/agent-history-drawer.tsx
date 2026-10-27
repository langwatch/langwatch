import type { AgentHistoryEntry, AgentVersion } from "@langwatch/agent-contract";
import { Drawer } from "@langwatch/design-system/drawer";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Badge, Box, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { SkeletonRows } from "@langwatch/design-system/skeletons";
import {
  ArrowUp,
  Bot,
  Copy,
  Edit,
  History,
  type LucideIcon,
  RefreshCw,
  Rocket,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useAgentVersions } from "../../behavior/use-agent-versions.ts";
import type { AgentClient } from "../../model/agent-client.ts";
import { AgentDeployDialog } from "../blocks/agent-deploy-dialog.tsx";

const ACTION_META = {
  "agents.create": { label: "Created", icon: Bot },
  "agents.update": { label: "Updated", icon: Edit },
  "agents.delete": { label: "Deleted", icon: Trash2 },
  "agents.cascadeArchive": { label: "Archived", icon: Trash2 },
  "agents.copy": { label: "Replicated", icon: Copy },
  "workflow.copyAgent": { label: "Replicated", icon: Copy },
  "agents.pushToCopies": { label: "Pushed to replicas", icon: ArrowUp },
  "agents.syncFromSource": { label: "Synced from source", icon: RefreshCw },
  "agents.assignLabel": { label: "Deployed a label", icon: Rocket },
  "agents.removeLabel": { label: "Removed a label", icon: Rocket },
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
  const versions = useAgentVersions({
    agents: props.agents,
    projectId: props.projectId,
    agentId: props.agentId,
  });
  const [deployOpen, setDeployOpen] = useState(false);
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
    <Drawer
      onClose={() => props.onClose()}
      title={`${props.agentName} history`}
      {...(versions.versions.length > 0
        ? { headerAction: { label: "Deploy", onClick: () => setDeployOpen(true) } }
        : {})}
    >
      {versions.versions.length > 0 && (
        <VersionList versions={versions.versions} formatCreatedAt={props.formatCreatedAt} />
      )}
      <AgentDeployDialog
        open={deployOpen}
        onClose={() => setDeployOpen(false)}
        agentName={props.agentName}
        state={versions}
      />
      {versions.versions.length > 0 && (
        <Text fontWeight="semibold" fontSize="sm" paddingTop={4} paddingBottom={2}>
          Activity
        </Text>
      )}
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

function VersionList({
  versions,
  formatCreatedAt,
}: {
  versions: AgentVersion[];
  formatCreatedAt: (createdAt: AgentVersion["createdAt"]) => string;
}) {
  return (
    <VStack align="stretch" gap={2} data-testid="agent-versions">
      <Text fontWeight="semibold" fontSize="sm">
        Versions
      </Text>
      {versions.map((row) => (
        <HStack
          key={row.id}
          justify="space-between"
          align="start"
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="md"
          paddingX={3}
          paddingY={2}
        >
          <VStack align="start" gap={0} minWidth={0}>
            <HStack gap={2}>
              <Text fontFamily="mono" fontSize="sm" fontWeight="semibold">
                v{row.version}
              </Text>
              {row.labels.map((label) => (
                <Badge key={label} size="xs" variant="subtle" colorPalette="green">
                  {label}
                </Badge>
              ))}
            </HStack>
            {row.commitMessage && (
              <Text fontSize="sm" truncate maxWidth="100%">
                {row.commitMessage}
              </Text>
            )}
            <Text color="fg.muted" fontSize="xs">
              {authorOf(row)} · {formatCreatedAt(row.createdAt)}
            </Text>
          </VStack>
        </HStack>
      ))}
    </VStack>
  );
}

function authorOf(row: AgentVersion): string {
  if (row.author) return row.author.name ?? row.author.email ?? "Unknown user";
  return row.authorKind === "api_key" ? "API key" : "LangWatch";
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
