import { useFeatureFlag } from "@langwatch/feature-flag-client";
import { FrontendFlags } from "@langwatch/feature-flag-contract";
import type { TraceHeader } from "@langwatch/trace-contract";

import { useTraceQueryArgs } from "../../../behavior/explorer/use-trace-query-args.ts";
import { api } from "../../../behavior/trace-api.ts";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";
import {
  type InstantEvalResultEntry,
  toInstantEvalResultEntry,
} from "../../../model/instant-eval-trace-results.ts";

interface TraceInstantEvalResults {
  /** Whether the drawer shows the section at all: `release_instant_eval_results`. */
  isShown: boolean;
  results: InstantEvalResultEntry[];
  isLoading: boolean;
}

/**
 * The trace's kept Instant Evals results (ADR-189 section 3), read over the trace's own time
 * window, which prunes the partitions, and only with `release_instant_eval_results` on.
 */
export function useTraceInstantEvalResults({
  trace,
}: {
  trace: Pick<TraceHeader, "traceId" | "timestamp" | "durationMs">;
}): TraceInstantEvalResults {
  const { isReady, queryArgs } = useTraceQueryArgs();
  const { organization } = useOrganizationTeamProject();
  const { enabled: isReleased } = useFeatureFlag(FrontendFlags.release_instant_eval_results, {
    projectId: queryArgs.tenantId ?? queryArgs.projectId,
    organizationId: organization?.id,
    enabled: isReady,
  });

  const query = api.traces.instantEvalResults.useQuery(
    {
      projectId: queryArgs.projectId,
      traceId: queryArgs.traceId,
      occurredFrom: trace.timestamp,
      occurredUntil: trace.timestamp + trace.durationMs,
      ...(queryArgs.tenantId !== undefined ? { tenantId: queryArgs.tenantId } : {}),
    },
    // The header can still be the previous trace's while the new one loads.
    { enabled: isReady && isReleased && trace.traceId === queryArgs.traceId },
  );

  return {
    isShown: isReleased,
    results: (query.data ?? []).map(toInstantEvalResultEntry),
    isLoading: isReleased && query.isLoading,
  };
}
