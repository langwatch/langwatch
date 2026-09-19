import { useEffect, useMemo, useRef } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { isInstantEvalRunActive } from "~/server/app-layer/instant-evals/run/instant-eval-explorer";
import { api } from "~/utils/api";
import { useInstantEvalRunStore } from "../stores/instantEvalRunStore";
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
  const trpcUtils = api.useUtils();

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

  // A change of progress means a page of verdicts landed: the table and the
  // sidebar read the judgements table through the chip, so both refetch.
  const progressSignature = Object.values(runs)
    .map(
      (run) => `${run.id}:${run.status}:${run.progress}:${run.matched ?? ""}`,
    )
    .join("|");
  const previousSignature = useRef(progressSignature);
  useEffect(() => {
    if (previousSignature.current === progressSignature) return;
    previousSignature.current = progressSignature;
    void trpcUtils.tracesV2.list.invalidate();
    void trpcUtils.tracesV2.sessions.invalidate();
    void trpcUtils.tracesV2.facets.invalidate();
  }, [progressSignature, trpcUtils]);
}
