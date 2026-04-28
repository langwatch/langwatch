import { useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { parseOccurredAtMs } from "./useTraceOccurredAt";

export function useTraceHeader() {
  const { project } = useOrganizationTeamProject();
  // Read traceId from the URL — it's the canonical source of truth on
  // hard reload. Reading from the zustand store would leave the query
  // disabled on the first render (the store only syncs from the URL via
  // a post-mount effect), causing a "Trace not found" flash before the
  // refetch had a chance to run.
  const params = useDrawerParams();
  const traceId = params.traceId;
  const occurredAtMs = parseOccurredAtMs(params.t);

  return api.tracesV2.header.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: traceId ?? "",
      ...(occurredAtMs !== undefined ? { occurredAtMs } : {}),
    },
    {
      enabled: !!project?.id && !!traceId,
      staleTime: 300_000,
    },
  );
}
