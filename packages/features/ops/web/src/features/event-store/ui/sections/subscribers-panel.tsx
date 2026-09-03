import { useMemo } from "react";

import { useOpsPermission } from "../../../../behavior/ops-session";
import { SubscribersCard as SubscribersCardView } from "../elements/subscribers-card";
import { joinSubscriberHealth, type SubscriberHealthRow } from "../../model/subscriber-health";
import { api } from "../../../../behavior/ops-api";

import { useOpsToaster, useShowErrorToast } from "../../../../behavior/ops-feedback";
function usePauseActions() {
  const showErrorToast = useShowErrorToast();
  const toaster = useOpsToaster();
  const utils = api.useUtils();
  const pauseMutation = api.ops.pausePipeline.useMutation({
    onSuccess: (_, vars) => {
      toaster.create({ title: `Paused ${vars.key}`, type: "success" });
      void utils.ops.invalidate();
    },
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't pause the subscriber" }),
  });
  const unpauseMutation = api.ops.unpausePipeline.useMutation({
    onSuccess: (_, vars) => {
      toaster.create({ title: `Unpaused ${vars.key}`, type: "success" });
      void utils.ops.invalidate();
    },
    onError: (error) =>
      showErrorToast({
        error,
        fallbackTitle: "Couldn't unpause the subscriber",
      }),
  });
  return { pauseMutation, unpauseMutation };
}

export function SubscribersCard() {
  const { hasAccess } = useOpsPermission();
  const registry = api.ops.listProjections.useQuery(undefined, {
    staleTime: 10 * 60 * 1000,
  });
  const dashboard = api.ops.getDashboardSnapshot.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const actions = usePauseActions();

  const rows = useMemo(
    () =>
      joinSubscriberHealth({
        subscribers: registry.data?.eventSubscribers ?? [],
        pipelineTree: dashboard.data?.pipelineTree ?? [],
        pausedKeys: dashboard.data?.pausedKeys ?? [],
      }),
    [registry.data, dashboard.data],
  );
  const queueName = dashboard.data?.queues[0]?.name;

  const onTogglePause = (row: SubscriberHealthRow, selectedQueue: string) => {
    const mutation = row.isPaused ? actions.unpauseMutation : actions.pauseMutation;
    mutation.mutate({ queueName: selectedQueue, key: row.pauseKey });
  };

  return (
    <SubscribersCardView
      rows={rows}
      queueName={queueName}
      hasAccess={hasAccess}
      onTogglePause={onTogglePause}
      isPausePending={(row) => {
        const mutation = row.isPaused ? actions.unpauseMutation : actions.pauseMutation;
        return mutation.isPending && mutation.variables?.key === row.pauseKey;
      }}
    />
  );
}
