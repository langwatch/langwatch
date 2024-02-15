import { useOrganizationTeamProject } from "./useOrganizationTeamProject";
import { api } from "../utils/api";
import { useRouter } from "next/router";

export function useTraceDetailsState(trace_id?: string) {
  const router = useRouter();
  const traceId =
    typeof router.query.trace === "string"
      ? router.query.trace
      : trace_id
      ? trace_id
      : undefined;
  const spanId =
    typeof router.query.span === "string" ? router.query.span : undefined;
  const openTab =
    typeof router.query.openTab === "string" ? router.query.openTab : undefined;
  const { project } = useOrganizationTeamProject();
  const trace = api.traces.getById.useQuery(
    { projectId: project?.id ?? "", traceId: traceId ?? "" },
    { enabled: !!project && !!traceId, refetchOnWindowFocus: false }
  );

  return { traceId, spanId, trace, openTab };
}
