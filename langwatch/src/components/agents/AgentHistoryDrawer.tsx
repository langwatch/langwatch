import { Box, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import {
  ArrowUp,
  Bot,
  Copy,
  Edit,
  type LucideIcon,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { Drawer } from "../ui/drawer";

const ACTION_META = {
  "agents.create": { label: "Created", icon: Bot },
  "agents.update": { label: "Updated", icon: Edit },
  "agents.delete": { label: "Deleted", icon: Trash2 },
  "agents.cascadeArchive": { label: "Archived", icon: Trash2 },
  "agents.copy": { label: "Replicated", icon: Copy },
  "agents.pushToCopies": { label: "Pushed to replicas", icon: ArrowUp },
  "agents.syncFromSource": { label: "Synced from source", icon: RefreshCw },
} as const satisfies Record<string, { label: string; icon: LucideIcon }>;

function actionMeta(action: string) {
  return (ACTION_META as Record<string, { label: string; icon: LucideIcon }>)[action] ?? { label: action, icon: X };
}

export function AgentHistoryDrawer({
  agentId,
  agentName,
}: {
  agentId: string;
  agentName?: string;
}) {
  const { closeDrawer } = useDrawer();
  const { project } = useOrganizationTeamProject();

  const { data, isLoading, isError } = api.agents.getHistory.useQuery(
    { agentId, projectId: project?.id ?? "" },
    { enabled: !!project?.id && !!agentId },
  );

  return (
    <Drawer.Root open={true} placement="end" size="md" onOpenChange={closeDrawer}>
      <Drawer.Content>
        <Drawer.Header>
          <Text fontWeight="semibold" fontSize="lg">
            {agentName ? `${agentName} history` : "Agent history"}
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
            <Text color="red.fg" textAlign="center" paddingY={8}>
              Failed to load history.
            </Text>
          )}
          {!isLoading && !isError && (!data || data.length === 0) && (
            <Text color="fg.muted" textAlign="center" paddingY={8}>
              No history recorded yet.
            </Text>
          )}
          {data && data.length > 0 && (
            <VStack gap={0} align="stretch">
              {data.map((entry, i) => {
                const { label, icon: Icon } = actionMeta(entry.action);
                const isLast = i === data.length - 1;
                return (
                  <HStack key={entry.id} align="start" gap={3}>
                    {/* Timeline line + icon */}
                    <VStack gap={0} align="center" flexShrink={0} width="24px">
                      <Box
                        bg="blue.subtle"
                        borderRadius="full"
                        padding={1}
                        mt="2px"
                      >
                        <Icon size={12} color="var(--chakra-colors-blue-fg)" />
                      </Box>
                      {!isLast && (
                        <Box
                          width="1px"
                          flex={1}
                          minHeight="24px"
                          bg="border.muted"
                        />
                      )}
                    </VStack>

                    {/* Content */}
                    <VStack align="start" gap={0} paddingBottom={4} flex={1}>
                      <Text fontWeight="medium" fontSize="sm">
                        {label}
                      </Text>
                      <Text color="fg.muted" fontSize="xs">
                        {entry.user?.name ?? entry.user?.email ?? "Unknown user"}{" "}
                        · {formatTimeAgo(new Date(entry.createdAt).getTime())}
                      </Text>
                    </VStack>
                  </HStack>
                );
              })}
            </VStack>
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
