import { Box, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import {
  ArrowUp,
  CheckSquare,
  Copy,
  Edit,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { Drawer } from "../ui/drawer";

const ACTION_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ size?: number }> }
> = {
  "evaluators.create": { label: "Created", icon: CheckSquare },
  "evaluators.update": { label: "Updated", icon: Edit },
  "evaluators.delete": { label: "Deleted", icon: Trash2 },
  "evaluators.cascadeArchive": { label: "Archived", icon: Trash2 },
  "evaluators.copy": { label: "Replicated", icon: Copy },
  "evaluators.pushToCopies": { label: "Pushed to replicas", icon: ArrowUp },
  "evaluators.syncFromSource": { label: "Synced from source", icon: RefreshCw },
};

function actionMeta(action: string) {
  return ACTION_META[action] ?? { label: action, icon: X };
}

export function EvaluatorHistoryDrawer({
  evaluatorId,
}: {
  evaluatorId: string;
}) {
  const { closeDrawer } = useDrawer();
  const { project } = useOrganizationTeamProject();

  const { data, isLoading } = api.evaluators.getHistory.useQuery(
    { evaluatorId, projectId: project?.id ?? "" },
    { enabled: !!project?.id && !!evaluatorId },
  );

  return (
    <Drawer.Root open={true} placement="end" size="md" onOpenChange={closeDrawer}>
      <Drawer.Content>
        <Drawer.Header>
          <Text fontWeight="semibold" fontSize="lg">
            Evaluator history
          </Text>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          {isLoading && (
            <HStack justify="center" paddingY={8}>
              <Spinner />
            </HStack>
          )}
          {!isLoading && (!data || data.length === 0) && (
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
