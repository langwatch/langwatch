import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useDrawerStore } from "../stores/drawerStore";

export function useSpanTree() {
  const { project } = useOrganizationTeamProject();
  const traceId = useDrawerStore((s) => s.traceId);

  return api.tracesV2.spanTree.useQuery(
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
