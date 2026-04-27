import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useDrawerStore } from "../stores/drawerStore";

export function useSpansFull(enabled: boolean) {
  const { project } = useOrganizationTeamProject();
  const traceId = useDrawerStore((s) => s.traceId);

  return api.tracesV2.spansFull.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: traceId ?? "",
    },
    {
      enabled: enabled && !!project?.id && !!traceId,
      staleTime: 300_000,
    },
  );
}
