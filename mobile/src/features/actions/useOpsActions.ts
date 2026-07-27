import { trpc } from "@/api/trpc";
import {
  actionSpec,
  anomalyActions,
  blobActions,
  CANARY_COUNT,
  deadLetterActions,
  groupActions,
  jobActions,
  pausedKeyActions,
  pausedTenantActions,
  queueActions,
} from "@/lib/actions";
import { formatCount } from "@/lib/format";

import type { ActionOutcome, BoundAction } from "./ActionSheet";

/**
 * Binds the action catalog to the ops mutations.
 *
 * Every mutation here is a procedure the web console already calls — there is no
 * mobile-only write path, and each one runs its own `ops:manage` check and lands
 * in the audit trail attributed to the operator, exactly as it would from a
 * browser.
 *
 * After anything that changes a queue, the whole queue-shaped surface is
 * invalidated rather than the one list the operator was looking at. An unblock
 * moves the dashboard counters, the tab badge, the blocked summary and the DLQ
 * list all at once, and a screen still showing the old number is how an operator
 * ends up running the same action twice.
 */
function useQueueInvalidation() {
  const utils = trpc.useContext();

  return async () => {
    await Promise.all([
      utils.ops.listQueues.invalidate(),
      utils.ops.listGroups.invalidate(),
      utils.ops.getGroupDetail.invalidate(),
      utils.ops.getGroupJobSummaries.invalidate(),
      utils.ops.getBlockedSummary.invalidate(),
      utils.ops.listAllDlqGroups.invalidate(),
      utils.ops.listPausedKeys.invalidate(),
      utils.ops.listPausedTenants.invalidate(),
      utils.ops.getBadgeCounts.invalidate(),
      utils.ops.getDashboardSnapshot.invalidate(),
    ]);
  };
}

/** Actions on a whole queue. `enabled` is the sheet being open. */
export function useQueueActions({
  queue,
  enabled,
}: {
  queue: { name: string; blockedGroupCount: number; dlqCount: number };
  enabled: boolean;
}): BoundAction[] {
  const invalidate = useQueueInvalidation();

  const unblockAll = trpc.ops.unblockAll.useMutation();
  const canaryUnblock = trpc.ops.canaryUnblock.useMutation();
  const canaryRedrive = trpc.ops.canaryRedrive.useMutation();
  const moveAllToDlq = trpc.ops.moveAllBlockedToDlq.useMutation();
  const replayAllDlq = trpc.ops.replayAllFromDlq.useMutation();

  // Only while the sheet is open: a preview is a keyspace walk, and firing one
  // every time a queue screen renders would make browsing cost as much as acting.
  const drainPreview = trpc.ops.drainAllBlockedPreview.useQuery(
    { queueName: queue.name },
    { enabled },
  );

  const preview = {
    loading: drainPreview.isLoading,
    empty: (drainPreview.data?.totalAffected ?? 0) === 0,
    headline: `${formatCount(drainPreview.data?.totalAffected ?? 0)} blocked groups`,
    lines: [
      ...(drainPreview.data?.byPipeline ?? []).map(
        (entry) => `${entry.name} — ${formatCount(entry.count)}`,
      ),
      ...(drainPreview.data?.byError ?? [])
        .slice(0, 5)
        .map((entry) => `${entry.message} — ${formatCount(entry.count)}`),
    ],
  };

  const bound: BoundAction[] = [];
  for (const spec of queueActions(queue)) {
    switch (spec.id) {
      case "canary-unblock":
        bound.push({
          spec,
          run: async () => {
            const result = await canaryUnblock.mutateAsync({
              queueName: queue.name,
              count: CANARY_COUNT,
            });
            await invalidate();
            return named("Unblocked", result.unblockedCount, result.groupIds);
          },
        });
        break;
      case "canary-redrive":
        bound.push({
          spec,
          run: async () => {
            const result = await canaryRedrive.mutateAsync({
              queueName: queue.name,
              count: CANARY_COUNT,
            });
            await invalidate();
            return named("Redrove", result.redrivenCount, result.groupIds);
          },
        });
        break;
      case "unblock-all":
        bound.push({
          spec,
          run: async () => {
            const result = await unblockAll.mutateAsync({ queueName: queue.name });
            await invalidate();
            return {
              summary: `Unblocked ${formatCount(result.unblockedCount)} groups.`,
            };
          },
        });
        break;
      case "move-all-blocked-to-dlq":
        bound.push({
          spec,
          preview,
          run: async () => {
            const result = await moveAllToDlq.mutateAsync({
              queueName: queue.name,
            });
            await invalidate();
            return {
              summary: `Moved ${formatCount(result.movedCount)} groups and ${formatCount(
                result.jobsMoved,
              )} jobs to dead letters. They can be replayed from there.`,
            };
          },
        });
        break;
      case "replay-all-dlq":
        bound.push({
          spec,
          run: async () => {
            const result = await replayAllDlq.mutateAsync({
              queueName: queue.name,
            });
            await invalidate();
            return {
              summary: `Replayed ${formatCount(result.replayedCount)} groups and ${formatCount(
                result.jobsReplayed,
              )} jobs.`,
            };
          },
        });
        break;
      default:
        break;
    }
  }
  return bound;
}

export function useGroupActions({
  queueName,
  group,
}: {
  queueName: string;
  group: { groupId: string; isBlocked: boolean; pendingJobs: number };
}): BoundAction[] {
  const invalidate = useQueueInvalidation();

  const unblock = trpc.ops.unblockGroup.useMutation();
  const drain = trpc.ops.drainGroup.useMutation();
  const moveToDlq = trpc.ops.moveToDlq.useMutation();

  const input = { queueName, groupId: group.groupId };

  return groupActions(group).map((spec): BoundAction => {
    switch (spec.id) {
      case "unblock-group":
        return {
          spec,
          run: async () => {
            const result = await unblock.mutateAsync(input);
            await invalidate();
            return {
              summary: result.wasBlocked
                ? "Unblocked. If whatever failed is still failing, it will block again."
                : "It was not blocked by the time this ran, so nothing changed.",
            };
          },
        };
      case "move-group-to-dlq":
        return {
          spec,
          run: async () => {
            const result = await moveToDlq.mutateAsync(input);
            await invalidate();
            return {
              summary: `Moved ${formatCount(result.jobsMoved)} jobs to dead letters. They can be replayed from there.`,
            };
          },
        };
      case "drain-group":
      default:
        return {
          spec,
          run: async () => {
            const result = await drain.mutateAsync(input);
            await invalidate();
            return {
              summary: `Discarded ${formatCount(result.jobsRemoved)} jobs.`,
            };
          },
        };
    }
  });
}

export function useJobActions({
  queueName,
  group,
  jobId,
}: {
  queueName: string;
  group: { groupId: string; isBlocked: boolean };
  jobId: string;
}): BoundAction[] {
  const invalidate = useQueueInvalidation();
  const retry = trpc.ops.retryBlocked.useMutation();

  return jobActions(group).map((spec): BoundAction => ({
    spec,
    run: async () => {
      const result = await retry.mutateAsync({
        queueName,
        groupId: group.groupId,
        jobId,
      });
      await invalidate();
      return {
        summary: result.wasBlocked
          ? "Retried. Watch whether the group clears."
          : "The group was not blocked by the time this ran, so nothing changed.",
      };
    },
  }));
}

export function useDeadLetterActions({
  queueName,
  groupId,
}: {
  queueName: string;
  groupId: string;
}): BoundAction[] {
  const invalidate = useQueueInvalidation();
  const replay = trpc.ops.replayFromDlq.useMutation();

  return deadLetterActions().map((spec): BoundAction => ({
    spec,
    run: async () => {
      const result = await replay.mutateAsync({ queueName, groupId });
      await invalidate();
      return {
        summary: `Replayed ${formatCount(result.jobsReplayed)} jobs.`,
      };
    },
  }));
}

export function useAnomalyActions({
  tenantId,
}: {
  tenantId: string;
}): BoundAction[] {
  const utils = trpc.useContext();
  const dismiss = trpc.ops.dismissAnomaly.useMutation();

  return anomalyActions().map((spec): BoundAction => ({
    spec,
    run: async () => {
      const result = await dismiss.mutateAsync({
        tenantId,
        kind: "rate_breaker",
      });
      await utils.ops.listAnomalies.invalidate();
      return {
        summary: result.dismissed
          ? "Dismissed. The next check will flag it again if the rate stays where it is."
          : "It was already gone.",
      };
    },
  }));
}

export function usePausedKeyActions({
  queueName,
  pausedKey,
}: {
  queueName: string;
  pausedKey: string;
}): BoundAction[] {
  const invalidate = useQueueInvalidation();
  const unpause = trpc.ops.unpausePipeline.useMutation();

  return pausedKeyActions().map((spec): BoundAction => ({
    spec,
    run: async () => {
      await unpause.mutateAsync({ queueName, key: pausedKey });
      await invalidate();
      return { summary: "Unpaused. It will start processing again." };
    },
  }));
}

export function usePausedTenantActions({
  queueName,
  tenantId,
}: {
  queueName: string;
  tenantId: string;
}): BoundAction[] {
  const invalidate = useQueueInvalidation();
  const unpause = trpc.ops.unpauseTenant.useMutation();
  const drain = trpc.ops.drainTenant.useMutation();

  return pausedTenantActions().map((spec): BoundAction => {
    if (spec.id === "unpause-tenant") {
      return {
        spec,
        run: async () => {
          await unpause.mutateAsync({ queueName, tenantId });
          await invalidate();
          return { summary: "Unpaused. Its work will start processing again." };
        },
      };
    }
    return {
      spec,
      run: async () => {
        const result = await drain.mutateAsync({ queueName, tenantId });
        await invalidate();
        return {
          summary: `Discarded ${formatCount(result.jobsDrained)} jobs across ${formatCount(
            result.groupsDrained,
          )} groups.`,
        };
      },
    };
  });
}

export function useBlobActions({
  blob,
}: {
  blob: {
    queueName: string;
    projectId: string;
    hash: string;
    liveLeases: number;
  };
}): BoundAction[] {
  const utils = trpc.useContext();
  const remove = trpc.ops.deleteBlob.useMutation();

  return blobActions(blob).map((spec): BoundAction => ({
    spec,
    run: async () => {
      const result = await remove.mutateAsync({
        queueName: blob.queueName,
        projectId: blob.projectId,
        hash: blob.hash,
        confirm: "DELETE",
      });
      await Promise.all([
        utils.ops.listBlobs.invalidate(),
        utils.ops.getBlobStoreStats.invalidate(),
      ]);
      return {
        summary: result.deleted
          ? "Deleted."
          : "Something took a lease on it before this ran, so it was left alone.",
      };
    },
  }));
}

/**
 * A canary reports the groups it touched, not just the count — the point of
 * trying five is being able to go and look at those five.
 */
function named(verb: string, count: number, groupIds: string[]): ActionOutcome {
  if (count === 0) return { summary: `${verb} nothing — there was none left.` };
  return {
    summary: `${verb} ${formatCount(count)}:\n${groupIds.join("\n")}`,
  };
}
