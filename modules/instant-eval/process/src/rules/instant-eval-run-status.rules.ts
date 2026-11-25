/**
 * Where a run is in its life, in the two spellings it is written in: the
 * stored one the projection folds, and the lowercase one every surface reads.
 */

import type { InstantEvalRunStatus } from "@langwatch/instant-eval-contract";

/** The stored spelling, as the run table carries it. */
export const INSTANT_EVAL_STORED_STATUSES = [
  "QUEUED",
  "PLANNING",
  "RUNNING",
  "FINISHED",
  "FAILED",
  "CANCELLED",
] as const;

export type InstantEvalStoredStatus = (typeof INSTANT_EVAL_STORED_STATUSES)[number];

const PUBLISHED: Readonly<Record<InstantEvalStoredStatus, InstantEvalRunStatus>> = {
  QUEUED: "queued",
  PLANNING: "planning",
  RUNNING: "running",
  FINISHED: "finished",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

/** The lowercase status a stored one publishes as. */
export function publishedInstantEvalStatus(stored: InstantEvalStoredStatus): InstantEvalRunStatus {
  return PUBLISHED[stored];
}

/** Whether a stored status is one the run table wrote, rather than drift. */
export function isInstantEvalStoredStatus(value: string): value is InstantEvalStoredStatus {
  return (INSTANT_EVAL_STORED_STATUSES as readonly string[]).includes(value);
}
