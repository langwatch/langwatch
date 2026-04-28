import { useDrawerParams } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

export function useTraceHeader() {
  const { project } = useOrganizationTeamProject();
  // Read traceId from the URL — it's the canonical source of truth on
  // hard reload. Reading from the zustand store would leave the query
  // disabled on the first render (the store only syncs from the URL via
  // a post-mount effect), causing a "Trace not found" flash before the
  // refetch had a chance to run.
  const params = useDrawerParams();
  const traceId = params.traceId;
  // The row click that opened the drawer typically already knows the
  // trace's timestamp — passing it lets the server narrow the partition
  // scan instead of hitting cold storage. Missing/invalid hints fall back
  // to the unconstrained query path on the server.
  const occurredAtMs = parseTimestamp(params.t);

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

function parseTimestamp(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
