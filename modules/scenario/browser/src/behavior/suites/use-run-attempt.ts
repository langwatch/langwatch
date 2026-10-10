/**
 * The identity of the run a person is trying to queue, held across a failed
 * attempt so a retry deduplicates on the server instead of queueing a second
 * batch.
 */

import { generate, KSUID_RESOURCES } from "@langwatch/ksuid";
import { useCallback, useRef } from "react";

export type RunAttempt = {
  /** What the person is queueing: subject, targets, note and parameters. */
  key: string;
  idempotencyKey: string;
  batchRunId: string;
};

/**
 * One identity per attempt, not per click: a request that timed out may already
 * have been accepted, so a retry carries the same key and the same batch id.
 * A different `key`, or `clearRunAttempt` after a queued run, starts a new one.
 */
export function useRunAttempt() {
  const attemptRef = useRef<RunAttempt | null>(null);

  const takeRunAttempt = useCallback((key: string): RunAttempt => {
    if (attemptRef.current?.key !== key) {
      attemptRef.current = {
        key,
        idempotencyKey: crypto.randomUUID(),
        batchRunId: generate(KSUID_RESOURCES.SCENARIO_BATCH).toString(),
      };
    }
    return attemptRef.current;
  }, []);

  const clearRunAttempt = useCallback(() => {
    attemptRef.current = null;
  }, []);

  return { takeRunAttempt, clearRunAttempt };
}
