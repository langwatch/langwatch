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
 * Polls every run behind the query's `eval` chips until it has settled, keeps
 * the run store current, and refetches the list and the facets on every
 * change of progress so matches appear as pages finish. Mounted once, on the
 * Explorer page.
 *
 * Spec: specs/traces-v2/instant-eval-search.feature ("Matches appear as
 * pages finish", "A stopped run is read until its numbers hold still").
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
  const settled = useInstantEvalRunStore((s) => s.settled);
  const setRun = useInstantEvalRunStore((s) => s.setRun);
  const keepOnly = useInstantEvalRunStore((s) => s.keepOnly);
  useEffect(() => {
    keepOnly(runIds);
  }, [runIds, keepOnly]);

  // A run is read until it has settled, not until its status turns terminal:
  // the page it held when it stopped lands its verdicts after that.
  const results = api.useQueries((t) =>
    runIds.map((runId) => {
      const isWatched = !settled[runId];
      return t.tracesV2.instantEval.get(
        { projectId, runId },
        {
          enabled: !!projectId,
          refetchInterval: isWatched ? INSTANT_EVAL_POLL_MS : false,
          staleTime: isWatched ? 0 : 60_000,
        },
      );
    }),
  );

  // Every poll answer lands in the store, which also notes an ended run whose
  // counters came back unchanged. `dataUpdatedAt` is what tells two equal
  // answers apart, so the second one is counted once and not on every render.
  const answers = results.map((result) => ({
    run: result.data,
    at: result.dataUpdatedAt ?? 0,
  }));
  const lastAnswer = useRef<
    Record<string, { run: InstantEvalExplorerRun; at: number }>
  >({});
  useEffect(() => {
    for (const { run, at } of answers) {
      if (!run) continue;
      const last = lastAnswer.current[run.id];
      if (last && last.at === at && last.run === run) continue;
      lastAnswer.current[run.id] = { run, at };
      setRun(run);
    }
  });

  useRefetchOnRunProgress(runs);
  useSettleQuietRuns();
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

/**
 * An ended run whose counters held still gets its final read: the table and
 * the sidebar read once more, and only when both have answered is the run
 * settled. Until then every count on the page keeps reading the run's
 * counters, so no surface shows a total the next read replaces.
 */
function useSettleQuietRuns(): void {
  const trpcUtils = api.useUtils();
  const quiet = useInstantEvalRunStore((s) => s.quiet);
  const settled = useInstantEvalRunStore((s) => s.settled);
  const markSettled = useInstantEvalRunStore((s) => s.markSettled);
  const settling = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const runId of Object.keys(quiet)) {
      if (settled[runId] || settling.current.has(runId)) continue;
      settling.current.add(runId);
      void Promise.allSettled([
        trpcUtils.tracesV2.list.invalidate(),
        trpcUtils.tracesV2.sessions.invalidate(),
        trpcUtils.tracesV2.facets.invalidate(),
      ]).then(() => {
        settling.current.delete(runId);
        markSettled(runId);
      });
    }
  }, [quiet, settled, markSettled, trpcUtils]);
}
