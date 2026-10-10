import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { HStack } from "@langwatch/design-system/primitives";

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

  const projectionLabel = projectionLabelOf(activeProjectionNames);

  return (
    <Banner
      status="info"
      title="Replay running"
      action={
        status.runId || hasAccess ? (
          <HStack gap={2}>
            {status.runId && (
              <BannerAction onClick={() => router.push(`/ops/projections/${status.runId}`)}>
                View Progress
              </BannerAction>
            )}
            {hasAccess && (
              <BannerAction
                loading={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
              >
                Cancel
              </BannerAction>
            )}
          </HStack>
        ) : undefined
      }
    >
      {projectionLabel}
    </Banner>
  );
}

/** The one projection replaying, or how many are. */
function projectionLabelOf(names: string[]): string | null {
  if (names.length > 1) return `${names.length} projections`;
  return names[0] ?? null;
}
