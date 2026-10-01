import { isLegacyOnlineEvaluationWorkbenchState } from "@langwatch/experiment-contract";
import { useMemo } from "react";

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

  const performance = monitorApi.monitors.getPerformanceForProject.useQuery(
    { projectId: projectId ?? "", timeZone: timeZone },
    {
      enabled: !!projectId && canViewAnalytics && monitors.isSuccess,
      refetchOnWindowFocus: false,
      trpc: { context: { skipBatch: true } },
    },
  );

  const experiments = monitorApi.experiments.getAllByProjectId.useQuery(
    { projectId: projectId ?? "" },
    {
      enabled: !!projectId && canManage && canViewExperiments && monitors.isSuccess,
      refetchOnWindowFocus: false,
      trpc: { context: { skipBatch: true } },
    },
  );

  const performanceByMonitor = useMemo(
    () => new Map(performance.data?.map((item) => [item.monitorId, item] as const) ?? []),
    [performance.data],
  );

  const experimentSlugs = useMemo(
    () =>
      new Map(
        (experiments.data ?? [])
          .filter((experiment) => isLegacyOnlineEvaluationWorkbenchState(experiment.workbenchState))
          .map((experiment) => [experiment.id, experiment.slug] as const),
      ),
    [experiments.data],
  );

  const monitorById = useMemo(
    () => new Map((monitors.data ?? []).map((monitor) => [monitor.id, monitor] as const)),
    [monitors.data],
  );

  const rows =
    monitors.data?.map((monitor) => ({
      id: monitor.id,
      name: monitor.name,
      checkType: monitor.checkType,
      enabled: monitor.enabled,
      executionMode: monitor.executionMode,
      performance: performanceByMonitor.get(monitor.id),
      hasPerformanceError: performance.isError,
    })) ?? [];

  return { monitors, performance, rows, monitorById, experimentSlugs };
}
