import { TRACE_QUERY_CONFIG } from "@langwatch/trace-contract";

import { promptApi } from "./prompt-api.ts";
import { usePromptProject } from "./use-prompt-project.ts";

/**
 * The trace behind a playground turn. Traces land a beat after the message
 * snapshot, so it retries quietly; a replay does not, since a trace that is
 * not there is not coming.
 */
export function usePlaygroundTrace({
  traceId,
  live,
}: {
  traceId: string | undefined;
  live: boolean;
}) {
  const { project } = usePromptProject();
  const projectId = project?.id ?? "";
  return promptApi.traces.getById.useQuery(
    { projectId, traceId: traceId ?? "" },
    {
      enabled: !!projectId && !!traceId,
      ...TRACE_QUERY_CONFIG,
      retry: live ? TRACE_QUERY_CONFIG.retry : 0,
    },
  );
}
