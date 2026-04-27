import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { Evaluation } from "~/server/tracer/types";
import type { EvalSummary } from "../types/trace";
import { useDrawerStore } from "../stores/drawerStore";

export type RichEval = EvalSummary & {
  evaluatorId: string;
  spanId?: string;
  spanName?: string;
  reasoning?: string;
  executionTime?: number;
};

export interface TraceEvaluationsResult {
  rich: RichEval[];
  pendingCount: number;
  isLoading: boolean;
  isError: boolean;
}

function mapStatus(ev: Evaluation): EvalSummary["status"] {
  if (ev.status === "error") return "fail";
  if (ev.status === "processed") {
    if (ev.passed === true) return "pass";
    if (ev.passed === false) return "fail";
    return "pass";
  }
  return "warning";
}

function mapScoreType(ev: Evaluation): EvalSummary["scoreType"] {
  if (typeof ev.score === "number") return "numeric";
  if (ev.passed != null) return "boolean";
  if (ev.label != null) return "categorical";
  return "numeric";
}

function mapScore(ev: Evaluation): number | boolean {
  if (typeof ev.score === "number") return ev.score;
  if (ev.passed != null) return ev.passed;
  return 0;
}

export function useTraceEvaluations(): TraceEvaluationsResult {
  const { project } = useOrganizationTeamProject();
  const traceId = useDrawerStore((s) => s.traceId);

  const query = api.traces.getEvaluations.useQuery(
    { projectId: project?.id ?? "", traceId: traceId ?? "" },
    {
      enabled: !!project?.id && !!traceId,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  );

  return useMemo(() => {
    const all = query.data ?? [];
    const pendingCount = all.filter(
      (e) => e.status === "scheduled" || e.status === "in_progress",
    ).length;

    const rich: RichEval[] = all
      .filter(
        (e) =>
          e.status === "processed" ||
          e.status === "error" ||
          e.status === "skipped",
      )
      .map((e) => {
        const started = e.timestamps.started_at ?? null;
        const finished = e.timestamps.finished_at ?? null;
        const executionTime =
          started != null && finished != null && finished >= started
            ? finished - started
            : undefined;

        return {
          evaluatorId: e.evaluator_id,
          name: e.name,
          score: mapScore(e),
          scoreType: mapScoreType(e),
          status: mapStatus(e),
          spanId: e.span_id ?? undefined,
          reasoning: e.details ?? undefined,
          executionTime,
        };
      });

    return {
      rich,
      pendingCount,
      isLoading: query.isLoading,
      isError: query.isError,
    };
  }, [query.data, query.isLoading, query.isError]);
}
