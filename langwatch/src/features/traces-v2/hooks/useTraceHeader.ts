import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useDrawerStore } from "../stores/drawerStore";

export function useTraceHeader() {
  const { project } = useOrganizationTeamProject();
  const traceId = useDrawerStore((s) => s.traceId);

  return api.tracesV2.header.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: traceId ?? "",
    },
    {
      enabled: !!project?.id && !!traceId,
      staleTime: 300_000,
    },
  );
}
