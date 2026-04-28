import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { Evaluation } from "~/server/tracer/types";
import type { EvalSummary } from "../types/trace";
import { useDrawerStore } from "../stores/drawerStore";

export type RichEval = EvalSummary & {
  evaluationId: string;
  evaluatorId: string;
  evaluatorType?: string;
  spanId?: string;
  spanName?: string;
  /**
   * Free-text explanation produced by the evaluator (`details` on the
   * Evaluation). For pass/fail/warn this is the model's reasoning; for
   * skipped runs it's the "why we didn't run" message.
   */
  reasoning?: string;
  /** Categorical/string label, when the evaluator produces one. */
  label?: string;
  /** Boolean pass/fail flag from a numeric/categorical evaluator. */
  passed?: boolean;
  /** Inputs the evaluator actually saw — useful for understanding a verdict. */
  inputs?: Record<string, unknown>;
  /**
   * Crash details when the evaluator errored. `message` is human-readable;
   * `stacktrace` is the full Python/JS trace if the worker captured one.
   */
  errorMessage?: string;
  errorStacktrace?: string[];
  retries?: number;
  executionTime?: number;
  evalCost?: number;
  /** Wall-clock when the evaluator started, ms epoch. Used to order history. */
  timestamp?: number;
};

export interface TraceEvaluationsResult {
  rich: RichEval[];
  pendingCount: number;
  isLoading: boolean;
  isError: boolean;
}

function mapStatus(ev: Evaluation): EvalSummary["status"] {
  // Preserve the distinction between "evaluator failed to run" and
  // "evaluator ran and the verdict was fail". Earlier this collapsed
  // skipped/error into warning/fail, which produced misleading "WARN
  // 0.00 / 1.00" rows for evaluators that were never configured.
  if (ev.status === "error") return "error";
  if (ev.status === "skipped") return "skipped";
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
          evaluationId: e.evaluation_id,
          evaluatorId: e.evaluator_id,
          evaluatorType: e.type ?? undefined,
          name: e.name,
          score: mapScore(e),
          scoreType: mapScoreType(e),
          status: mapStatus(e),
          spanId: e.span_id ?? undefined,
          reasoning: e.details ?? undefined,
          label: e.label ?? undefined,
          passed: e.passed ?? undefined,
          inputs:
            e.inputs && typeof e.inputs === "object"
              ? (e.inputs as Record<string, unknown>)
              : undefined,
          errorMessage: e.error?.message ?? undefined,
          errorStacktrace: e.error?.stacktrace ?? undefined,
          retries: e.retries ?? undefined,
          executionTime,
          timestamp: started ?? undefined,
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
