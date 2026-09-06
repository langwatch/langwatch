import { useOpsPermission } from "../../../../behavior/ops-session.ts";
import { api } from "../../../../behavior/ops-api.ts";
import { isSlotStale } from "../../model/scheduler-presentation.ts";
import { SchedulerContentView } from "./scheduler-content.tsx";
import { SchedulerRowActions } from "./scheduler-row-actions.tsx";

/** App transport adapter for the controlled scheduler presentation surface. */
export function SchedulerContent() {
  const jobsQuery = api.ops.listScheduledJobs.useQuery({ limit: 200 }, { refetchInterval: 10_000 });
  const actionsQuery = api.ops.listSchedulerActions.useQuery(
    { limit: 10 },
    {
      refetchInterval: 30_000,
      enabled: (jobsQuery.data?.length ?? 0) > 0,
    },
  );
  const { hasAccess } = useOpsPermission();
  const now = jobsQuery.dataUpdatedAt || Date.now();
  const jobs = jobsQuery.data ?? [];

  return (
    <SchedulerContentView
      jobs={jobs}
      recentActions={actionsQuery.data ?? []}
      isLoading={jobsQuery.isLoading}
      hasAccess={hasAccess}
      now={now}
      renderActions={(job, status, renderNow) => (
        <SchedulerRowActions
          scheduleId={job.id}
          targetType={job.targetType}
          targetId={job.targetId}
          projectName={job.projectName}
          status={status}
          canClearSlot={isSlotStale({ job, now: renderNow })}
          onDone={() => void jobsQuery.refetch()}
        />
      )}
    />
  );
}
