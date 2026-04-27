import { useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export function useErrorCount(): number {
  const { project } = useOrganizationTeamProject();

  // Fixed at mount time — the refetchInterval keeps data fresh without
  // changing the query key on every render.
  const [timeRange] = useState(() => {
    const now = Date.now();
    return { from: now - TWENTY_FOUR_HOURS_MS, to: now, live: true };
  });

  const query = api.tracesV2.newCount.useQuery(
    {
      projectId: project?.id ?? "",
      timeRange,
      since: timeRange.from,
      query: "status:error",
    },
    {
      enabled: !!project?.id,
      staleTime: 30_000,
      refetchInterval: 30_000,
    },
  );

  return query.data?.count ?? 0;
}
