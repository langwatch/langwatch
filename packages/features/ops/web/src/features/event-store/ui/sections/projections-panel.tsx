import { useMemo } from "react";
import { ProjectionsCard as ProjectionsCardView } from "../elements/projections-card";
import { joinProjectionHealth } from "../../model/projection-health";
import { api } from "../../../../behavior/ops-api";

export function ProjectionsCard() {
  const registry = api.ops.listProjections.useQuery(undefined, {
    staleTime: 10 * 60 * 1000,
  });
  const dashboard = api.ops.getDashboardSnapshot.useQuery(undefined, {
    refetchInterval: 15_000,
  });

  const rows = useMemo(
    () =>
      joinProjectionHealth({
        projections: registry.data?.projections ?? [],
        pipelineTree: dashboard.data?.pipelineTree ?? [],
      }),
    [registry.data, dashboard.data],
  );

  return <ProjectionsCardView rows={rows} />;
}
