import { ListPageSkeleton } from "@langwatch/design-system/list-page";
import { HandledErrorAlert } from "@langwatch/error-views";
import { useMemo } from "react";

import { api } from "../../../../behavior/ops-api.ts";
import { joinProjectionHealth } from "../../model/projection-health.ts";
import { ProjectionsCard as ProjectionsCardView } from "../elements/projections-card.tsx";

export function ProjectionsCard() {
  const registry = api.ops.listProjections.useQuery(undefined, {
    staleTime: 10 * 60 * 1000,
  });
  const dashboard = api.ops.getDashboardSnapshot.useQuery(undefined, {});

  const rows = useMemo(
    () =>
      joinProjectionHealth({
        projections: registry.data?.projections ?? [],
        pipelineTree: dashboard.data?.pipelineTree ?? [],
      }),
    [registry.data, dashboard.data],
  );

  if (registry.isPending || dashboard.isPending) {
    return <ListPageSkeleton label="Loading projections" />;
  }
  if ((registry.isError || dashboard.isError) && (!registry.data || !dashboard.data)) {
    return (
      <HandledErrorAlert
        error={registry.error ?? dashboard.error}
        fallbackTitle="The projections could not load"
      />
    );
  }

  return (
    <>
      {(registry.isError || dashboard.isError) && (
        <HandledErrorAlert
          error={registry.error ?? dashboard.error}
          fallbackTitle="Projections could not refresh; showing the last snapshot"
        />
      )}
      <ProjectionsCardView rows={rows} />
    </>
  );
}
