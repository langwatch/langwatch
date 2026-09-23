/**
 * Polls every run behind the query's `eval` chips until it settles, keeps the
 * run store current, and reads the list and the facets again as progress moves
 * so matches appear as pages finish. Mounted once, on the Explorer page.
 * @see specs/traces-v2/instant-eval-search.feature
 */

import { nowInstant } from "@langwatch/time";
import {
  type ExplorerInstantEvalProgress,
  isExplorerInstantEvalRunActive,
} from "@langwatch/trace-contract";
import { useEffect, useMemo, useRef } from "react";

import { useInstantEvalRunStore } from "../../../../behavior/instant-eval-run.store.ts";
import { api } from "../../../../behavior/trace-api.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { dueInstantEvalRefetches } from "../../../../model/instant-eval-refetch-pacing.ts";
import { useInstantEvalRuns } from "./use-instant-eval-runs.ts";

/** How often a judging run is read while it judges, the CLI's own cadence. */
export const INSTANT_EVAL_POLL_MS = 1_000;

export function useInstantEvalRunWatch(): void {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const { chips } = useInstantEvalRuns();
  const runIds = useMemo(
    () => [...new Set(chips.flatMap((chip) => (chip.runId ? [chip.runId] : [])))],
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
      return t.traces.instantEvalGet(
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
  const lastAnswer = useRef<Record<string, { run: ExplorerInstantEvalProgress; at: number }>>({});
  useEffect(() => {
    storeNewAnswers({ answers, lastAnswer: lastAnswer.current, setRun });
  });

  useRefetchOnRunProgress(runs);
  useSettleQuietRuns();
}

/** Each poll answer the store has not already been given, once. */
function storeNewAnswers({
  answers,
  lastAnswer,
  setRun,
}: {
  answers: { run: ExplorerInstantEvalProgress | undefined; at: number }[];
  lastAnswer: Record<string, { run: ExplorerInstantEvalProgress; at: number }>;
  setRun: (run: ExplorerInstantEvalProgress) => void;
}): void {
  for (const { run, at } of answers) {
    if (!run) continue;
    const last = lastAnswer[run.id];
    if (last && last.at === at && last.run === run) continue;
    lastAnswer[run.id] = { run, at };
    setRun(run);
  }
}

/**
 * A change of progress means a page of verdicts landed: the table and the
 * sidebar read the judgements through the chip, so both read again, paced
 * while the run judges (see `instant-eval-refetch-pacing`).
 */
function useRefetchOnRunProgress(runs: Record<string, ExplorerInstantEvalProgress>): void {
  const trpcUtils = api.useUtils();
  const progressSignature = Object.values(runs)
    .map((run) => `${run.id}:${run.status}:${run.progress}:${run.matched ?? ""}`)
    .join("|");
  const isAnyRunActive = Object.values(runs).some((run) =>
    isExplorerInstantEvalRunActive(run.status),
  );
  const previousSignature = useRef(progressSignature);
  const lastListAt = useRef(Number.NEGATIVE_INFINITY);
  const lastFacetsAt = useRef(Number.NEGATIVE_INFINITY);
  useEffect(() => {
    if (previousSignature.current === progressSignature) return;
    previousSignature.current = progressSignature;
    const now = nowInstant().epochMilliseconds;
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
      void trpcUtils.traces.list.invalidate(undefined, undefined, options);
      void trpcUtils.traces.sessions.invalidate(undefined, undefined, options);
    }
    if (due.facets) {
      lastFacetsAt.current = now;
      void trpcUtils.traces.facetValues.invalidate(undefined, undefined, options);
    }
  }, [progressSignature, isAnyRunActive, trpcUtils]);
}

/**
 * An ended run whose counters held still gets its final read: the table and
 * the sidebar read once more, and only when both have answered is the run
 * settled, so no surface shows a total the next read replaces.
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
        trpcUtils.traces.list.invalidate(),
        trpcUtils.traces.sessions.invalidate(),
        trpcUtils.traces.facetValues.invalidate(),
      ]).then(() => {
        settling.current.delete(runId);
        markSettled(runId);
      });
    }
  }, [quiet, settled, markSettled, trpcUtils]);
}
