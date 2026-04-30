import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { isPreviewTraceId } from "../components/EmptyState/samplePreviewTraces";
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
      enabled:
        !!project?.id &&
        !!traceId &&
        evalsExpanded &&
        !isPreviewTraceId(traceId),
      staleTime: 60_000,
      cacheTime: 1_800_000,
    },
  );
}
