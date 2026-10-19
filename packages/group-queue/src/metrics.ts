import { counter, gauge, histogram } from "@langwatch/observability/metrics";
import { nowInstant } from "@langwatch/time";

import { GroupQueueError, NonRetryableGroupQueueError } from "./errors.ts";

export const gqActiveGroups = gauge({
  name: "gq_active_groups",
  description: "Number of groups currently being processed",
});

export const gqPendingGroups = gauge({
  name: "gq_pending_groups",
  description: "Number of groups with pending jobs waiting to be dispatched",
});

export const gqGroupsBlockedTotal = counter({
  name: "gq_groups_blocked_total",
  description: "Total number of groups that have been blocked due to exhausted retries",
});

/** One series per pipeline/job of the blocked groups' head jobs; sum by queue_name for the total. */
export const gqBlockedGroups = gauge({
  name: "gq_blocked_groups",
  description:
    "Number of groups currently in the blocked state (jobs exhausted retries, awaiting manual unblock), by the pipeline and job of each group's head job; sum by queue_name for the queue total",
});

export const gqParkedGroups = gauge({
  name: "gq_parked_groups",
  description:
    "Number of groups parked out of the ready scan because their tenant is at the in-flight soft cap, per queue only (a per-job breakdown would read every parked group each cycle). A sustained spike is the over-cap signal that previously surfaced only as an invisible dispatch-write storm; a non-draining floor flags a parked-group strand.",
});

export const gqJobsStagedTotal = counter({
  name: "gq_jobs_staged_total",
  description: "Total number of jobs staged into the group queue",
});

export const gqJobsDispatchedTotal = counter({
  name: "gq_jobs_dispatched_total",
  description: "Total number of jobs dispatched from staging to the processing queue",
});

/**
 * Jobs admitted past a tenant's fair share so slots don't sit idle.
 * Distinguishes why `gq_parked_groups` is high: non-zero here means the
 * override is working; zero with a full fleet means it's waiting on capacity.
 */
export const gqJobsDispatchedOverrideTotal = counter({
  name: "gq_jobs_dispatched_override_total",
  description:
    "Jobs dispatched by the work-conserving override, past a tenant's fair share, into slots that would otherwise be idle",
});

export const gqJobsRecoveredTotal = counter({
  name: "gq_jobs_recovered_total",
  description:
    "Claimed jobs put back at the front of their group because the worker running them died (specs/claimed-job-recovery.feature)",
});

export const gqJobsCompletedTotal = counter({
  name: "gq_jobs_completed_total",
  description: "Total number of jobs completed successfully",
});

export const gqJobsDedupedTotal = counter({
  name: "gq_jobs_deduped_total",
  description: "Total number of jobs that were deduplicated (replaced existing staged job)",
});

export const gqJobsRetriedTotal = counter({
  name: "gq_jobs_retried_total",
  description: "Total number of intermediate retry attempts",
});

export const gqJobsExhaustedTotal = counter({
  name: "gq_jobs_exhausted_total",
  description: "Total number of jobs that exhausted all retry attempts",
});

export const gqJobsNonRetryableTotal = counter({
  name: "gq_jobs_non_retryable_total",
  description:
    "Total number of jobs that failed with non-retryable (critical) errors (reason: non_retryable_error | group_queue_error | classified)",
});

/** Why a failure was not retried, by error TYPE: error text would make the label unbounded. */
export type NonRetryableReason = "non_retryable_error" | "group_queue_error" | "classified";

export function nonRetryableReasonOf(error: unknown): NonRetryableReason {
  if (error instanceof NonRetryableGroupQueueError) return "non_retryable_error";
  if (error instanceof GroupQueueError) return "group_queue_error";
  return "classified";
}

export function recordNonRetryableJob({
  labels,
  error,
}: {
  labels: { queue_name: string; pipeline_name: string; job_type: string; job_name: string };
  error: unknown;
}): void {
  gqJobsNonRetryableTotal.inc({ ...labels, reason: nonRetryableReasonOf(error) });
}

export const gqFastqPending = gauge({
  name: "gq_fastq_pending",
  description: "Number of jobs queued in fastq waiting to be processed",
});

export const gqFastqActive = gauge({
  name: "gq_fastq_active",
  description: "Number of jobs currently being processed by fastq workers",
});

// --- Delayed job metrics ---
export const gqJobsDelayedTotal = counter({
  name: "gq_jobs_delayed_total",
  description: "Total number of jobs staged with an intentional delay",
});

export const gqJobDelayMilliseconds = histogram({
  name: "gq_job_delay_milliseconds",
  description: "Duration of intentional delays applied to staged jobs",
});

// --- Retry metrics ---
export const gqRetryAttempt = histogram({
  name: "gq_retry_attempt",
  description: "Distribution of retry attempt numbers",
});

export const gqRetryBackoffMilliseconds = histogram({
  name: "gq_retry_backoff_milliseconds",
  description: "Duration of retry backoff delays in milliseconds",
});

// --- Per-job duration metric ---

/**
 * Failed reads of the group retry-chain counter. A failed read returns 0, so a
 * sibling-led retry is indistinguishable from a genuine fresh delivery — it
 * resets the retry budget and makes the fold discard what the chain applied.
 */
export const gqGroupAttemptReadFailuresTotal = counter({
  name: "gq_group_attempt_read_failures_total",
  description:
    "Failed reads of the group retry-chain counter; a retry may read as a fresh delivery",
});

export const gqJobDurationMilliseconds = histogram({
  name: "gq_job_duration_milliseconds",
  description: "Duration of individual job processing in milliseconds",
});

// --- Oldest pending age gauge ---
export const gqOldestPendingAgeMilliseconds = gauge({
  name: "gq_oldest_pending_age_milliseconds",
  description:
    "Age of the oldest pending job in the ready sorted set (milliseconds), labelled with that group's pipeline and job; earlier holders read 0, so take max by queue_name",
});

/**
 * Backlog age the eligible-waiting gauge is blind to: a group in retry
 * backoff has its ready score rewritten to now+backoff each attempt, so this
 * clocks the per-group jobs zset instead, whose scores survive retries/parks.
 */
export const gqOldestBacklogAgeMilliseconds = gauge({
  name: "gq_oldest_backlog_age_milliseconds",
  description:
    "Age of the oldest due job across sampled groups regardless of dispatch eligibility (catches groups pinned in retry backoff)",
});

/**
 * Deepest single group's staging hash. Aggregate gauges miss this — one group
 * with hundreds of thousands of fields looks unremarkable (2026-06 incident:
 * ~290k fields, ~2.9 GB). "Deepest seen this sweep rotation," not "right now."
 */
export const gqGroupStagingDepthMax = gauge({
  name: "gq_group_staging_depth_max",
  description:
    "Staged jobs in the deepest single group seen in the current sweep rotation (catches one hot group accumulating behind unremarkable aggregates)",
});

/**
 * Groups at or above {@link STAGING_DEPTH_REPORT_FLOOR} — separate from the
 * max because they answer different alarms: one deep group is a hot key,
 * a thousand is the drainer having stopped, and each wants a different response.
 */
export const gqGroupsOverStagingDepth = gauge({
  name: "gq_groups_over_staging_depth",
  description:
    "Groups whose staging hash is at or above the reporting floor, in the current sweep rotation",
});

/**
 * Depth at which a group counts as accumulating. Inclusive, since a round
 * number is the one most likely chosen deliberately. Reporting only — nothing
 * in the queue changes behaviour when a group crosses it.
 */
export const STAGING_DEPTH_REPORT_FLOOR = 10_000;

/**
 * Jobs whose producer-supplied ready score the queue refused. Raised the
 * moment it's rejected, before the bad score is written — a post-hoc ready-set
 * scan would find nothing and report zero forever.
 */
export const gqReadyScoreImplausibleTotal = counter({
  name: "gq_ready_score_implausible_total",
  description:
    "Jobs staged with a producer score the queue rejected (not a timestamp, or outside the allowed skew around now) and replaced with the staging time",
});

// --- Blob lifecycle observability ---

/**
 * A stored blob exceeded the decode cap — possible tamper / zip-bomb.
 * Distinct from a missing blob.
 */
export const gqBlobDecodeCapExceededTotal = counter({
  name: "gq_blob_decode_cap_exceeded_total",
  description:
    "Blob read exceeded the decode byte cap — treated as missing (possible tamper / zip-bomb)",
});

/** Producer rejected a payload at the encode cap — bounds worker memory (ADR-026). */
export const gqPayloadTooLargeTotal = counter({
  name: "gq_payload_too_large_total",
  description: "Payload rejected at the encode cap",
});

/**
 * Claim-side poison guard parked a group into the blocked set. reason:
 * "claim_strikes" = consecutive worker deaths while in flight;
 * "oversized_payload" = staged value over the decode cap.
 */
export const gqGroupsPoisonParkedTotal = counter({
  name: "gq_groups_poison_parked_total",
  description:
    "Groups parked into the blocked set by a poison guard (reason: claim_strikes | oversized_payload | failure_streak)",
});

/**
 * Retry re-encode failed, so the slot dropped to the fail-safe without
 * re-staging. Distinct from `gqJobsNonRetryableTotal` (genuine process()
 * errors), so oncall can tell "bad payload" from "encode blipped mid-retry".
 */
export const gqRetryEncodeFailuresTotal = counter({
  name: "gq_retry_encode_failures_total",
  description:
    "Retry re-encode failed — dispatched job completed via fail-safe and the job was DISCARDED (replay does not recover subscriber jobs; see gq_jobs_dropped_total)",
});

/**
 * A staged job that couldn't be decoded and was discarded (#5538: the drop
 * path used to call `scripts.complete()`, so a discard read as a success).
 * A non-zero rate is permanent work loss unless the owning app replays.
 */
export const gqJobsDroppedTotal = counter({
  name: "gq_jobs_dropped_total",
  description: "Staged jobs discarded because they could not be decoded",
});

export const gqJobsLastDroppedTimestampSeconds = gauge({
  name: "gq_jobs_last_dropped_timestamp_seconds",
  description:
    "Unix timestamp of the latest discarded job in this process. Detects the first discard without a previous counter sample; not durable across an unscraped process exit.",
});

export function recordDroppedJob(labels: {
  queue_name: string;
  pipeline_name: string;
  job_type: string;
  job_name: string;
  reason: string;
}): void {
  gqJobsDroppedTotal.inc(labels);
  gqJobsLastDroppedTimestampSeconds.set(nowInstant().epochMilliseconds / 1000, labels);
}

/**
 * A dispatched job whose pipeline this worker hasn't registered — normal
 * during a rolling deploy, as old workers reject it for a new build to take.
 * A rate outliving the deploy means a pipeline was removed without a tombstone.
 */
export const gqJobsUnroutableTotal = counter({
  name: "gq_jobs_unroutable_total",
  description:
    "Dispatched jobs rejected because their pipeline is not registered in this worker (usually a mid-rollout build skew)",
});

/**
 * A release retired a blob's LAST lease, dropping its expiry from the 4-day
 * backstop to the grace window. Near-zero while jobs complete means reclaim
 * isn't happening. Terminal retirement only — a floor, not a total.
 */
export const gqBlobReleaseGraceTotal = counter({
  name: "gq_blob_release_grace_total",
  description:
    'Blobs whose last lease was retired via terminal retirement, moving them from the 4-day backstop onto the release grace window (excludes the dedup-squash release path — a floor, not a total). The "tier" label is where the blob lived, not which provider stored it: "redis" or "s3", where "s3" means the durable object store whatever its scheme — an Azure Blob deployment reports "s3" here.',
});

/**
 * Every blob the reclaim runner examined, by outcome — outcomes partition the
 * WHOLE keyspace, so `sum by (outcome)` is a total, not a floor. `repaired`
 * rising means releases are missed; only `reclaimed` frees bytes.
 */
export const gqBlobSweepTotal = counter({
  name: "gq_blob_sweep_total",
  description:
    "Blobs examined by the reclaim runner, by outcome (leased, repaired, reclaimed, bookkeeping, pending) — outcomes partition the keyspace, so this is a total, not a floor",
});

/**
 * Drained siblings restaged because `__jobName` differed from the dispatched
 * job's (ADR-066). Distinct from batch-failure restage, which restages the
 * whole batch. Steady means mixed traffic; a spike flags a key collision.
 */
export const gqForeignSiblingsRestagedTotal = counter({
  name: "gq_foreign_siblings_restaged_total",
  description:
    "Drained siblings restaged untouched because their __jobName differed from the dispatched job (ADR-066 mixed-command isolation) — excludes the batch-failure restage paths",
});

/**
 * A coalesced batch failed retryably and split in half to isolate the cause.
 * Increments ONCE PER SPLIT, not once per batch. Steady non-zero means the
 * batch bound is too generous, or a payload is persistently unprocessable.
 */
export const gqBatchBisectionsTotal = counter({
  name: "gq_batch_bisections_total",
  description:
    "Retryable coalesced-batch failures that were split in half to isolate the cause — increments once per split, so one failing batch costs several",
});
