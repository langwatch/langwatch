import { TRACE_QUERY_CONFIG } from "@langwatch/trace-contract";

import { api } from "../scenario-api.ts";

/** The trace one turn of a run produced; it lands a beat after the message snapshot. */
export function useTurnTrace({
  projectId,
  traceId,
}: {
  projectId: string | undefined;
  traceId: string;
}) {
  return api.traces.getById.useQuery(
    { projectId: projectId ?? "", traceId },
    { enabled: !!projectId && !!traceId, ...TRACE_QUERY_CONFIG },
  );
}
