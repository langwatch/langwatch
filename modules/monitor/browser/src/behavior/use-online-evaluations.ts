import { isLegacyOnlineEvaluationWorkbenchState } from "@langwatch/experiment-contract";

import { monitorApi } from "./monitor-api.ts";

/** The project's online evaluations, their seven-day performance and the legacy workbenches. */
export function useOnlineEvaluations({
  projectId,
  timeZone,
  canManage,
  canViewAnalytics,
  canViewExperiments,
}: {
  projectId: string | undefined;
  timeZone: string;
  canManage: boolean;
  canViewAnalytics: boolean;
  canViewExperiments: boolean;
}) {
  const monitors = monitorApi.monitors.getAllForProject.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );

  const performance = monitorApi.evaluations.getMonitorPerformanceForProject.useQuery(
    { projectId: projectId ?? "", timeZone: timeZone },
    {
      enabled: !!projectId && canViewAnalytics && monitors.isSuccess,
    },
  );

  const experiments = monitorApi.experiments.getAllByProjectId.useQuery(
    { projectId: projectId ?? "" },
    {
      enabled: !!projectId && canManage && canViewExperiments && monitors.isSuccess,
    },
  );

  const performanceByMonitor = new Map(
    performance.data?.map((item) => [item.monitorId, item] as const) ?? [],
  );

  const experimentSlugs = new Map(
    (experiments.data ?? [])
      .filter((experiment) => isLegacyOnlineEvaluationWorkbenchState(experiment.workbenchState))
      .map((experiment) => [experiment.id, experiment.slug] as const),
  );

  const monitorById = new Map(
    (monitors.data ?? []).map((monitor) => [monitor.id, monitor] as const),
  );

  const rows =
    monitors.data?.map((monitor) => ({
      id: monitor.id,
      name: monitor.name,
      checkType: monitor.checkType,
      enabled: monitor.enabled,
      autoPausedReason: monitor.enabled ? null : (monitor.autoPausedReason ?? null),
      executionMode: monitor.executionMode,
      createdByName: monitor.createdBy?.name ?? null,
      performance: performanceByMonitor.get(monitor.id),
      hasPerformanceError: performance.isError,
    })) ?? [];

  return { monitors, performance, rows, monitorById, experimentSlugs };
}
