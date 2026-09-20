import { useEffect, useMemo, useRef } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  type InstantEvalExplorerRun,
  isInstantEvalRunActive,
} from "~/server/app-layer/instant-evals/run/instant-eval-explorer";
import { api } from "~/utils/api";
import { useInstantEvalRunStore } from "../stores/instantEvalRunStore";
import { dueInstantEvalRefetches } from "./instantEvalRefetchPacing";
import { useInstantEvalRuns } from "./useInstantEvalRuns";

/** How often a judging run is read while it judges, the CLI's own cadence. */
export const INSTANT_EVAL_POLL_MS = 1_000;

/**
 * Polls every run behind the query's `eval` chips while it judges, keeps
 * the run store current, and refetches the list and the facets on every
 * change of progress so matches appear as pages finish. Mounted once, on the
 * Explorer page.
 *
 * Spec: specs/traces-v2/instant-eval-search.feature ("Matches appear as
 * pages finish").
 */
export function useInstantEvalRunWatch(): void {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const { chips } = useInstantEvalRuns();
  const runIds = useMemo(
    () => [
      ...new Set(chips.flatMap((chip) => (chip.runId ? [chip.runId] : []))),
    ],
    [chips],
  );
  const runs = useInstantEvalRunStore((s) => s.runs);
  const setRun = useInstantEvalRunStore((s) => s.setRun);
  const keepOnly = useInstantEvalRunStore((s) => s.keepOnly);
  useEffect(() => {
    keepOnly(runIds);
  }, [runIds, keepOnly]);

  const results = api.useQueries((t) =>
    runIds.map((runId) => {
      const known = runs[runId];
      const active = !known || isInstantEvalRunActive(known.status);
      return t.tracesV2.instantEval.get(
        { projectId, runId },
        {
          enabled: !!projectId,
          refetchInterval: active ? INSTANT_EVAL_POLL_MS : false,
          staleTime: active ? 0 : 60_000,
        },
      );
    }),
  );

  // Every poll answer lands in the store; the store ignores answers that
  // move nothing, so a stable run does not re-render its readers.
  const latest = results.map((result) => result.data);
  useEffect(() => {
    for (const run of latest) {
      if (run) setRun(run);
    }
  });

  useRefetchOnRunProgress(runs);
}

/**
 * A change of progress means a page of verdicts landed: the table and the
 * sidebar read the judgements table through the chip, so both read again,
 * paced while the run judges (see `instantEvalRefetchPacing`).
 */
function useRefetchOnRunProgress(
  runs: Record<string, InstantEvalExplorerRun>,
): void {
  const trpcUtils = api.useUtils();
  const progressSignature = Object.values(runs)
    .map(
      (run) => `${run.id}:${run.status}:${run.progress}:${run.matched ?? ""}`,
    )
    .join("|");
  const isAnyRunActive = Object.values(runs).some((run) =>
    isInstantEvalRunActive(run.status),
  );
  const previousSignature = useRef(progressSignature);
  const lastListAt = useRef(Number.NEGATIVE_INFINITY);
  const lastFacetsAt = useRef(Number.NEGATIVE_INFINITY);
  useEffect(() => {
    if (previousSignature.current === progressSignature) return;
    previousSignature.current = progressSignature;
    const now = Date.now();
    const due = dueInstantEvalRefetches({
      now,
      lastListAt: lastListAt.current,
      lastFacetsAt: lastFacetsAt.current,
      isAnyRunActive,
    });
    // While a run judges, a read still in flight is left to finish: replacing
    // it only cancels the request, the server keeps running the query.
    const options = isAnyRunActive ? { cancelRefetch: false } : undefined;
    if (due.list) {
      lastListAt.current = now;
      void trpcUtils.tracesV2.list.invalidate(undefined, undefined, options);
      void trpcUtils.tracesV2.sessions.invalidate(
        undefined,
        undefined,
        options,
      );
    }
    if (due.facets) {
      lastFacetsAt.current = now;
      void trpcUtils.tracesV2.facets.invalidate(undefined, undefined, options);
    }
  }, [progressSignature, isAnyRunActive, trpcUtils]);
}
