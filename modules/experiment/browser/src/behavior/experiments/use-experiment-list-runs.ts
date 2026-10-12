import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { experimentApi } from "../experiment-api.ts";
import type { RunSlotQueue } from "./run-slot-queue.ts";

const RUNS_CACHE_MS = 5 * 60 * 1000;

/**
 * Waits for a slot while `wanted`, and gives it back when the row goes away. A new `round` asks
 * for a slot again, which is how a settled row gets back in line.
 */
function useRunSlot({
  slots,
  id,
  wanted,
  round,
}: {
  slots: RunSlotQueue;
  id: string;
  wanted: boolean;
  round: number;
}): boolean {
  useEffect(() => {
    if (!wanted) return;
    slots.request(id);
    return () => slots.release(id);
  }, [slots, id, wanted, round]);
  return useSyncExternalStore(
    slots.subscribe,
    () => slots.granted(id),
    () => false,
  );
}

/**
 * Every run of one list row, without items. A closed row waits for a slot, so few calls are in
 * flight; an open row (`urgent`) does not. Cached five minutes; a failure leaves the list's row.
 * `requeue` sends a closed row back through the slots to fetch again.
 */
export function useExperimentListRuns({
  projectId,
  experimentId,
  enabled,
  urgent,
  slots,
}: {
  projectId: string;
  experimentId: string;
  enabled: boolean;
  /** The row is open: its runs are wanted now. */
  urgent: boolean;
  slots: RunSlotQueue;
}) {
  const utils = experimentApi.useUtils();
  const [round, setRound] = useState(0);
  const granted = useRunSlot({ slots, id: experimentId, wanted: enabled, round });
  const query = experimentApi.experiments.getExperimentBatchEvaluationRuns.useQuery(
    { projectId, experimentId },
    {
      enabled: enabled && (urgent || granted),
      refetchOnWindowFocus: false,
      staleTime: RUNS_CACHE_MS,
      gcTime: RUNS_CACHE_MS,
      retry: false,
    },
  );
  // A cached answer older than the cache time is "settled" at once but refetches right after, so
  // the slot is kept until nothing is being fetched.
  const settled = (query.isSuccess || query.isError) && query.fetchStatus === "idle";
  useEffect(() => {
    if (granted && settled) slots.release(experimentId);
  }, [granted, settled, slots, experimentId]);
  /** Marks the cached runs out of date and queues the row for a fresh call. */
  const requeue = useCallback(() => {
    void utils.experiments.getExperimentBatchEvaluationRuns.invalidate({ projectId, experimentId });
    setRound((current) => current + 1);
  }, [utils, projectId, experimentId]);
  return { ...query, requeue };
}

/** One run with its items, fetched when a row is opened: the per-target numbers come from it. */
export function useExperimentRunItems({
  projectId,
  experimentId,
  runId,
  enabled,
}: {
  projectId: string;
  experimentId: string;
  runId: string | undefined;
  enabled: boolean;
}) {
  return experimentApi.experiments.getExperimentBatchEvaluationRun.useQuery(
    { projectId, experimentId, runId: runId ?? "" },
    { enabled: enabled && !!runId, refetchOnWindowFocus: false },
  );
}

/**
 * Brings a row's cached runs up to what the list reports, once per change (its run count or its
 * newest run). An open row refetches at once; a closed one goes back through the slots.
 */
export function useRefetchWhenStale({
  active,
  stamp,
  open,
  refetch,
  requeue,
}: {
  /** The row's cached runs no longer match the list. */
  active: boolean;
  /** Identifies what the list says now: acts once per distinct stamp. */
  stamp: string;
  open: boolean;
  refetch: () => unknown;
  requeue: () => unknown;
}) {
  const handled = useRef<string | undefined>(undefined);
  const latest = useRef({ open, refetch, requeue });
  latest.current = { open, refetch, requeue };
  useEffect(() => {
    if (!active || handled.current === stamp) return;
    handled.current = stamp;
    const { open: isOpen, refetch: now, requeue: later } = latest.current;
    void (isOpen ? now() : later());
  }, [active, stamp]);
}
