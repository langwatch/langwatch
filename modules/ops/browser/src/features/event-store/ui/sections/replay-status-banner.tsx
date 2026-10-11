import { Card } from "@langwatch/design-system/card";
import { Badge, Button, Status } from "@langwatch/design-system/primitives";

import { api } from "../../../../behavior/ops-api.ts";
import { useOpsRouter as useRouter } from "../../../../behavior/ops-router.ts";
import { useOpsPermission } from "../../../../behavior/ops-session.ts";
import { useReplayStatus } from "../../behavior/use-replay-status.ts";
import { parseActiveProjections } from "../../model/replay-presentation.ts";

export function ReplayStatusBanner() {
  const router = useRouter();
  const statusQuery = useReplayStatus();
  const cancelMutation = api.ops.cancelReplay.useMutation({
    onSuccess: () => void statusQuery.refetch(),
  });
  const { hasAccess } = useOpsPermission();

  const status = statusQuery.data;
  // Only show banner while actively running
  if (status?.state !== "running") return null;

  const activeProjectionNames = parseActiveProjections(status.currentProjection);

  return (
    <Card
      padding="sm"
      icon={
        <Status.Root colorPalette="blue">
          <Status.Indicator />
        </Status.Root>
      }
      title="Replay running"
      badge={
        activeProjectionNames.length > 0 ? (
          <Badge size="sm" variant="subtle">
            {activeProjectionNames.length === 1
              ? activeProjectionNames[0]
              : `${activeProjectionNames.length} projections`}
          </Badge>
        ) : (
          void 0
        )
      }
      actions={
        <>
          {status.runId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => router.push(`/ops/projections/${status.runId}`)}
            >
              View Progress
            </Button>
          )}
          {hasAccess && (
            <Button
              size="sm"
              colorPalette="red"
              variant="outline"
              loading={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              Cancel
            </Button>
          )}
        </>
      }
    />
  );
}
