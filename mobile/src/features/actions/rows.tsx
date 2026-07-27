import { useState } from "react";

import { ActionSheet, ActionsTrigger } from "./ActionSheet";
import { RowActions } from "./RowActions";
import {
  useAnomalyActions,
  useBlobActions,
  useDeadLetterActions,
  useGroupActions,
  useJobActions,
  usePausedKeyActions,
  usePausedTenantActions,
  useQueueActions,
} from "./useOpsActions";

/**
 * One tiny component per acted-on row.
 *
 * They exist because binding a row's actions means calling hooks, and hooks have
 * to sit at the top of a component — a screen cannot call `useGroupActions` once
 * per row inside a `map`. Each of these is that component, and nothing else.
 */

export function GroupRowActions({
  queueName,
  group,
}: {
  queueName: string;
  group: { groupId: string; isBlocked: boolean; pendingJobs: number };
}) {
  const actions = useGroupActions({ queueName, group });
  return (
    <RowActions label={group.groupId} title="Group actions" actions={actions} />
  );
}

export function JobRowActions({
  queueName,
  group,
  jobId,
}: {
  queueName: string;
  group: { groupId: string; isBlocked: boolean };
  jobId: string;
}) {
  const actions = useJobActions({ queueName, group, jobId });
  return <RowActions label={jobId} title="Job actions" actions={actions} />;
}

export function DeadLetterRowActions({
  queueName,
  groupId,
}: {
  queueName: string;
  groupId: string;
}) {
  const actions = useDeadLetterActions({ queueName, groupId });
  return (
    <RowActions label={groupId} title="Dead letter actions" actions={actions} />
  );
}

export function AnomalyRowActions({ tenantId }: { tenantId: string }) {
  const actions = useAnomalyActions({ tenantId });
  return (
    <RowActions label={tenantId} title="Anomaly actions" actions={actions} />
  );
}

export function PausedKeyRowActions({
  queueName,
  pausedKey,
}: {
  queueName: string;
  pausedKey: string;
}) {
  const actions = usePausedKeyActions({ queueName, pausedKey });
  return (
    <RowActions label={pausedKey} title="Pipeline actions" actions={actions} />
  );
}

export function PausedTenantRowActions({
  queueName,
  tenantId,
}: {
  queueName: string;
  tenantId: string;
}) {
  const actions = usePausedTenantActions({ queueName, tenantId });
  return (
    <RowActions label={tenantId} title="Project actions" actions={actions} />
  );
}

export function BlobRowActions({
  blob,
}: {
  blob: {
    queueName: string;
    projectId: string;
    hash: string;
    liveLeases: number;
  };
}) {
  const actions = useBlobActions({ blob });
  return (
    <RowActions label={blob.hash} title="Payload actions" actions={actions} />
  );
}

/**
 * The queue-level actions, in the screen header.
 *
 * Not a `RowActions`: the sweeping actions preview their blast radius, and that
 * preview must only be fetched while the sheet is open — so this component owns
 * the open state and feeds it to the hook.
 */
export function QueueActionsButton({
  queue,
}: {
  queue: {
    name: string;
    displayName: string;
    blockedGroupCount: number;
    dlqCount: number;
  };
}) {
  const [open, setOpen] = useState(false);
  const actions = useQueueActions({ queue, enabled: open });

  if (actions.length === 0) return null;

  return (
    <>
      <ActionsTrigger label={queue.displayName} onPress={() => setOpen(true)} />
      <ActionSheet
        title="Queue actions"
        subject={queue.displayName}
        actions={actions}
        visible={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
