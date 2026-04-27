import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useDrawerStore } from "../stores/drawerStore";

export function useSpanDetail() {
  const { project } = useOrganizationTeamProject();
  const traceId = useDrawerStore((s) => s.traceId);
  const spanId = useDrawerStore((s) => s.selectedSpanId);

  return api.tracesV2.spanDetail.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: traceId ?? "",
      spanId: spanId ?? "",
    },
    {
      enabled: !!project?.id && !!traceId && !!spanId,
      staleTime: 300_000,
    },
  );
}
