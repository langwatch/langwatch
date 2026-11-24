/**
 * Reads every run behind the query's `eval` chips until it settles, keeps the
 * run store current, and reads the list and the facets again as progress moves
 * so matches appear as pages finish. Mounted once, on the Explorer page.
 * @see specs/traces-v2/instant-eval-search.feature
 */

import type { ExplorerInstantEvalProgress } from "@langwatch/instant-eval-contract";
import { nowInstant } from "@langwatch/time";
import { isExplorerInstantEvalRunActive } from "@langwatch/trace-contract";
import { useEffect, useMemo, useRef } from "react";

import { api } from "../../../behavior/trace-api.ts";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";
import {
  instantEvalCatchUpDelayMs,
  isAwaitingInstantEvalEnd,
} from "../../../model/instant-eval-end-catch-up.ts";
import { dueInstantEvalRefetches } from "../../../model/instant-eval-refetch-pacing.ts";
import { useInstantEvalRunStore } from "./instant-eval-run.store.ts";
import { useInstantEvalRuns } from "./use-instant-eval-runs.ts";
import { useMarkRegisteredChipsTyped } from "./use-mark-registered-chips-typed.ts";

export function useInstantEvalRunWatch(): void {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const { chips } = useInstantEvalRuns();
  const runIds = useMemo(
    () => [...new Set(chips.flatMap((chip) => (chip.runId ? [chip.runId] : [])))],
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
      return t.instantEval.get(
        { projectId, runId },
        {
          enabled: !!projectId,
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

  useMarkRegisteredChipsTyped();
  useRefetchOnRunProgress(runs);
  useConfirmEndedRuns({ projectId, runs });
  useCatchUpEndingRuns({ projectId, runs });
  useSettleQuietRuns();
}

type CatchUpBudget = { startedAt: number; attempt: number };
type CatchUpTimers = Map<string, ReturnType<typeof setTimeout>>;

/** Arms the next read of one run from its own budget, or nothing once its window is spent. */
function scheduleCatchUp({
  runId,
  budgets,
  timers,
  read,
}: {
  runId: string;
  budgets: Map<string, CatchUpBudget>;
  timers: CatchUpTimers;
  read: (runId: string) => void;
}): void {
  const budget = budgets.get(runId) ?? { startedAt: nowInstant().epochMilliseconds, attempt: 0 };
  budgets.set(runId, budget);
  const waitedMs = nowInstant().epochMilliseconds - budget.startedAt;
  const delay = instantEvalCatchUpDelayMs({ attempt: budget.attempt, waitedMs });
  if (delay === null) return;
  timers.set(
    runId,
    setTimeout(() => {
      timers.delete(runId);
      budget.attempt += 1;
      read(runId);
      scheduleCatchUp({ runId, budgets, timers, read });
    }, delay),
  );
}

/** Drops the timer of every run that stopped waiting. */
function clearLeftRuns({ timers, awaited }: { timers: CatchUpTimers; awaited: Set<string> }) {
  for (const [runId, timer] of timers) {
    if (awaited.has(runId)) continue;
    clearTimeout(timer);
    timers.delete(runId);
  }
}

/**
 * A run with nothing left to judge, or one the reader stopped, is read again on a short backoff
 * until it says it ended: its end's hint can land before its row says so, and nothing hints again.
 * Each run keeps its own backoff and window while other runs join or leave the wait.
 */
function useCatchUpEndingRuns({
  projectId,
  runs,
}: {
  projectId: string;
  runs: Record<string, ExplorerInstantEvalProgress>;
}): void {
  const trpcUtils = api.useUtils();
  const stoppedByUser = useInstantEvalRunStore((s) => s.stoppedByUser);
  const budgets = useRef<Map<string, CatchUpBudget>>(new Map());
  const pending = useRef<CatchUpTimers>(new Map());
  const awaiting = Object.values(runs)
    .filter((run) => isAwaitingInstantEvalEnd({ run, isStopRequested: !!stoppedByUser[run.id] }))
    .map((run) => run.id)
    .toSorted()
    .join(",");
  useEffect(() => {
    const timers = pending.current;
    const awaited = new Set(projectId && awaiting ? awaiting.split(",") : []);
    clearLeftRuns({ timers, awaited });
    const read = (runId: string) => void trpcUtils.instantEval.get.invalidate({ projectId, runId });
    for (const runId of awaited) {
      if (timers.has(runId)) continue;
      scheduleCatchUp({ runId, budgets: budgets.current, timers, read });
    }
  }, [projectId, awaiting, trpcUtils]);
  useEffect(() => {
    const timers = pending.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);
}

/**
 * An ended run is read once more as soon as its ended answer lands: a run that
 * fails sends one event, so no later hint would bring the second read that
 * settles it. Each distinct answer asks once; no timer is involved.
 */
function useConfirmEndedRuns({
  projectId,
  runs,
}: {
  projectId: string;
  runs: Record<string, ExplorerInstantEvalProgress>;
}): void {
  const trpcUtils = api.useUtils();
  const quiet = useInstantEvalRunStore((s) => s.quiet);
  const asked = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!projectId) return;
    for (const run of Object.values(runs)) {
      if (isExplorerInstantEvalRunActive(run.status) || quiet[run.id]) continue;
      const answer = `${run.id}:${run.status}:${run.progress}:${run.total ?? ""}:${run.matched ?? ""}`;
      if (asked.current.has(answer)) continue;
      asked.current.add(answer);
      void trpcUtils.instantEval.get.invalidate({ projectId, runId: run.id });
    }
  }, [projectId, runs, quiet, trpcUtils]);
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
      void trpcUtils.codingAgents.sessionGroups.invalidate(undefined, undefined, options);
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
        trpcUtils.codingAgents.sessionGroups.invalidate(),
        trpcUtils.traces.facetValues.invalidate(),
      ]).then(() => {
        settling.current.delete(runId);
        markSettled(runId);
      });
    }
  }, [quiet, settled, markSettled, trpcUtils]);
}
