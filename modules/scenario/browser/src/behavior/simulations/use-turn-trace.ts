import type { RouterFromMap, UseTRPCQueryResult } from "@langwatch/api/web";
import { TRACE_QUERY_CONFIG } from "@langwatch/trace-contract";
import type { TRPCClientErrorLike } from "@trpc/client";

import { api, type RouterOutputs, type ScenarioApiMap } from "../scenario-api.ts";

/** The turn's trace read; naming it keeps the emitted declaration small. */
type TurnTraceQuery = UseTRPCQueryResult<
  RouterOutputs["traces"]["getById"],
  TRPCClientErrorLike<RouterFromMap<ScenarioApiMap>>
>;

/** The trace one turn of a run produced; it lands a beat after the message snapshot. */
export function useTurnTrace({
  projectId,
  traceId,
}: {
  projectId: string | undefined;
  traceId: string;
}): TurnTraceQuery {
  return api.traces.getById.useQuery(
    { projectId: projectId ?? "", traceId },
    { enabled: !!projectId && !!traceId, ...TRACE_QUERY_CONFIG },
  );
}
