/**
 * Who changed this evaluator, and when.
 *
 * THE ONE OVERLAY OF THIS FAMILY THAT TRAVELLED. `evaluatorHistory` had exactly
 * one opener in the whole repository — the evaluators page — so unlike the
 * editor, the code editor and the category picker it is not an application
 * drawer at all, and the gateway family's ruling applies: the registry is
 * COMPOSITION and a screen only ever needed the ADDRESS. The screen keeps the
 * evaluator in its own query string (`?history=<id>`) and renders the panel
 * inline, and `platform/app`'s registered copy stays for the URL that still
 * names it.
 */

import { Box, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { Drawer } from "@langwatch/design-system/drawer";
import {
  ArrowUp,
  CheckSquare,
  Copy,
  Edit,
  type LucideIcon,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";

import { evaluatorApi } from "../../behavior/evaluator-api";
import { formatTimeAgo } from "../../model/format-time-ago";
import { useEvaluatorHost } from "../../model/evaluator-host";

const ACTION_META = {
  "evaluators.create": { label: "Created", icon: CheckSquare },
  "evaluators.update": { label: "Updated", icon: Edit },
  "evaluators.delete": { label: "Deleted", icon: Trash2 },
  "evaluators.cascadeArchive": { label: "Archived", icon: Trash2 },
  "evaluators.copy": { label: "Replicated", icon: Copy },
  "evaluators.pushToCopies": { label: "Pushed to replicas", icon: ArrowUp },
  "evaluators.syncFromSource": { label: "Synced from source", icon: RefreshCw },
} as const satisfies Record<string, { label: string; icon: LucideIcon }>;

/**
 * An action the audit trail recorded that this table has no words for still
 * gets a row: the raw action name beats a silently missing entry in a history
 * somebody is reading to find out what happened.
 */
function actionMeta(action: string) {
  return (
    (ACTION_META as Record<string, { label: string; icon: LucideIcon }>)[action] ?? {
      label: action,
      icon: X,
    }
  );
}

export function EvaluatorHistoryPanel({
  evaluatorId,
  evaluatorName,
  onClose,
}: {
  evaluatorId: string;
  evaluatorName: string;
  onClose: () => void;
}) {
  const host = useEvaluatorHost();
  const { projectId } = host.scope();

  const { data, isLoading, isError } = evaluatorApi.evaluators.getHistory.useQuery(
    { evaluatorId, projectId: projectId ?? "" },
    { enabled: !!projectId && !!evaluatorId },
  );

  return (
    <Drawer.Root open placement="end" size="md" onOpenChange={() => onClose()}>
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Text fontWeight="semibold" fontSize="lg">
            {`${evaluatorName} history`}
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
          {!isLoading && !isError && (data?.length ?? 0) === 0 && (
            <Text color="fg.muted" textAlign="center" paddingY={8}>
              No history recorded yet.
            </Text>
          )}
          {data && data.length > 0 && (
            <VStack gap={0} align="stretch">
              {data.map((entry, index) => {
                const { label, icon: Icon } = actionMeta(entry.action);
                const isLast = index === data.length - 1;
                return (
                  <HStack key={entry.id} align="start" gap={3}>
                    <VStack gap={0} align="center" flexShrink={0} width="24px">
                      <Box bg="blue.subtle" borderRadius="full" padding={1} marginTop="2px">
                        <Icon size={12} color="var(--chakra-colors-blue-fg)" />
                      </Box>
                      {!isLast && <Box width="1px" flex={1} minHeight="24px" bg="border.muted" />}
                    </VStack>
                    <VStack align="start" gap={0} paddingBottom={4} flex={1}>
                      <Text fontWeight="medium" fontSize="sm">
                        {label}
                      </Text>
                      <Text color="fg.muted" fontSize="xs">
                        {entry.user?.name ?? entry.user?.email ?? "Unknown user"} ·{" "}
                        {formatTimeAgo(new Date(entry.createdAt).getTime())}
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
