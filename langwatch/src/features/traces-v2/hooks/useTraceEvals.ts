import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useDrawerStore } from "../stores/drawerStore";

export function useTraceEvals() {
  const { project } = useOrganizationTeamProject();
  const traceId = useDrawerStore((s) => s.traceId);
  const evalsExpanded = useDrawerStore((s) => s.evalsExpanded);

  return api.tracesV2.evals.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: traceId ?? "",
    },
    {
      enabled: !!project?.id && !!traceId && evalsExpanded,
      staleTime: 60_000,
      gcTime: 1_800_000,
    },
  );
}
