/**
 * Who changed this evaluator, and when: the `evaluatorHistory` drawer, opened
 * with `drawer.evaluatorId` and `drawer.evaluatorName` like main's.
 */

import { useDrawer } from "@langwatch/browser-host/drawer";
import { formatTimeAgo } from "@langwatch/browser-host/format-time-ago";
import { Drawer } from "@langwatch/design-system/drawer";
import { NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import { Box, HStack, Spinner, Text, VStack } from "@langwatch/design-system/primitives";
import { evaluatorClient } from "@langwatch/evaluator-client";
import { toEpochMs } from "@langwatch/time";
import {
  ArrowUp,
  CheckSquare,
  Copy,
  Edit,
  type LucideIcon,
  RefreshCw,
  Rocket,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";

import { useEvaluatorVersions } from "../../behavior/use-evaluator-versions.ts";
import { useEvaluatorHost } from "../../model/evaluator-host.ts";
import { EvaluatorDeployDialog } from "../blocks/evaluator-deploy-dialog.tsx";
import { EvaluatorVersionList } from "../blocks/evaluator-version-list.tsx";

const ACTION_META = {
  "evaluators.create": { label: "Created", icon: CheckSquare },
  "evaluators.update": { label: "Updated", icon: Edit },
  "evaluators.delete": { label: "Deleted", icon: Trash2 },
  "evaluators.cascadeArchive": { label: "Archived", icon: Trash2 },
  "evaluators.copy": { label: "Replicated", icon: Copy },
  "evaluators.pushToCopies": { label: "Pushed to replicas", icon: ArrowUp },
  "evaluators.syncFromSource": { label: "Synced from source", icon: RefreshCw },
  "evaluators.assignLabel": { label: "Deployed a label", icon: Rocket },
  "evaluators.removeLabel": { label: "Removed a label", icon: Rocket },
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
}: {
  evaluatorId: string;
  evaluatorName: string;
}) {
  const { closeDrawer } = useDrawer();
  const host = useEvaluatorHost();
  const { projectId } = host.scope();

  const { data, isLoading, isError } = evaluatorClient.evaluators.getHistory.useQuery(
    { evaluatorId, projectId: projectId ?? "" },
    { enabled: !!projectId && !!evaluatorId },
  );
  const versions = useEvaluatorVersions({ projectId: projectId ?? "", evaluatorId });
  const [deployOpen, setDeployOpen] = useState(false);
  const hasVersions = versions.versions.length > 0;

  return (
    <Drawer
      onClose={closeDrawer}
      title={`${evaluatorName} history`}
      {...(hasVersions
        ? { headerAction: { label: "Deploy", onClick: () => setDeployOpen(true) } }
        : {})}
    >
      {hasVersions && <EvaluatorVersionList versions={versions.versions} />}
      <EvaluatorDeployDialog
        open={deployOpen}
        onClose={() => setDeployOpen(false)}
        evaluatorName={evaluatorName}
        state={versions}
      />
      {hasVersions && (
        <Text fontWeight="semibold" fontSize="sm" paddingTop={4} paddingBottom={2}>
          Activity
        </Text>
      )}
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
        <NoDataInfoBlock
          size="line"
          title="No history recorded yet. Changes to this evaluator appear here once it is edited."
          next={[
            {
              kind: "docs",
              label: "Saved evaluators",
              href: "https://docs.langwatch.ai/evaluations/evaluators/saved-evaluators",
            },
          ]}
        />
      )}
      {data && data.length > 0 && (
        <VStack gap={0} align="stretch">
          {data.map((entry, index) => {
            const { label, icon: Icon } = actionMeta(entry.action);
            const isLast = index === data.length - 1;
            return (
              <HStack key={entry.id} align="start" gap={3}>
                <VStack gap={0} align="center" flexShrink={0} width="24px">
                  <Box bg="blue.subtle" borderRadius="full" padding={1} marginTop="0.5">
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
                    {formatTimeAgo(toEpochMs(entry.createdAt))}
                  </Text>
                </VStack>
              </HStack>
            );
          })}
        </VStack>
      )}
    </Drawer>
  );
}
