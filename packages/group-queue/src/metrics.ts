import { Counter, Gauge, Histogram, register } from "prom-client";

// Remove existing metrics if they exist (for hot reload)
const metricNames = [
  "gq_active_groups",
  "gq_pending_groups",
  "gq_blocked_groups",
  "gq_parked_groups",
  "gq_groups_blocked_total",
  "gq_jobs_staged_total",
  "gq_jobs_dispatched_total",
  "gq_jobs_completed_total",
  "gq_jobs_deduped_total",
  "gq_jobs_retried_total",
  "gq_jobs_exhausted_total",
  "gq_jobs_non_retryable_total",
  "gq_fastq_pending",
  "gq_fastq_active",
  "gq_jobs_delayed_total",
  "gq_job_delay_milliseconds",
  "gq_retry_attempt",
  "gq_retry_backoff_milliseconds",
  "gq_job_duration_milliseconds",
  "gq_oldest_pending_age_milliseconds",
  "gq_oldest_backlog_age_milliseconds",
  "gq_ready_score_implausible_total",
  // Canonical payload-envelope failures.
  "gq_blob_reclaim_s3_failures_total",
  "gq_blob_decode_cap_exceeded_total",
  "gq_payload_too_large_total",
  "gq_groups_poison_parked_total",
  "gq_retry_encode_failures_total",
  // #5538
  "gq_jobs_dropped_total",
  "gq_jobs_last_dropped_timestamp_seconds",
  "gq_group_attempt_read_failures_total",
  // 2026-07-22 blob-retention fix
  "gq_blob_release_grace_total",
  "gq_blob_sweep_total",
  // ADR-066 pillar 2 mixed-command isolation
  "gq_foreign_siblings_restaged_total",
  "gq_jobs_unroutable_total",
  "gq_batch_bisections_total",
  // Work-conserving override visibility
  "gq_jobs_dispatched_override_total",
  // #4682 single-group staging accumulation
  "gq_group_staging_depth_max",
  "gq_groups_over_staging_depth",
] as const;

for (const name of metricNames) {
  register.removeSingleMetric(name);
}

export const gqActiveGroups = new Gauge({
  name: "gq_active_groups",
  help: "Number of groups currently being processed",
  labelNames: ["queue_name"] as const,
});

export const gqPendingGroups = new Gauge({
  name: "gq_pending_groups",
  help: "Number of groups with pending jobs waiting to be dispatched",
  labelNames: ["queue_name"] as const,
});

export const gqGroupsBlockedTotal = new Counter({
  name: "gq_groups_blocked_total",
  help: "Total number of groups that have been blocked due to exhausted retries",
  labelNames: ["queue_name", "pipeline_name", "job_type", "job_name"] as const,
});

export const gqBlockedGroups = new Gauge({
  name: "gq_blocked_groups",
  help: "Number of groups currently in the blocked state (jobs exhausted retries, awaiting manual unblock)",
  labelNames: ["queue_name"] as const,
});

export const gqParkedGroups = new Gauge({
  name: "gq_parked_groups",
  help: "Number of groups parked out of the ready scan because their tenant is at the in-flight soft cap. A sustained spike is the over-cap signal that previously surfaced only as an invisible dispatch-write storm; a non-draining floor flags a parked-group strand.",
  labelNames: ["queue_name"] as const,
});

export const gqJobsStagedTotal = new Counter({
  name: "gq_jobs_staged_total",
  help: "Total number of jobs staged into the group queue",
  labelNames: ["queue_name"] as const,
});

export const gqJobsDispatchedTotal = new Counter({
  name: "gq_jobs_dispatched_total",
  help: "Total number of jobs dispatched from staging to the processing queue",
  labelNames: ["queue_name"] as const,
});

/**
 * Jobs admitted past a tenant's fair share because slots would otherwise sit
 * idle. Distinguishes why `gq_parked_groups` is high: a non-zero rate here
 * means the override is working; a flat zero with a full fleet means parked
 * work is waiting on capacity, not fairness.
 */
export const gqJobsDispatchedOverrideTotal = new Counter({
  name: "gq_jobs_dispatched_override_total",
  help: "Jobs dispatched by the work-conserving override, past a tenant's fair share, into slots that would otherwise be idle",
  labelNames: ["queue_name"] as const,
});

export const gqJobsCompletedTotal = new Counter({
  name: "gq_jobs_completed_total",
  help: "Total number of jobs completed successfully",
  labelNames: ["queue_name", "pipeline_name", "job_type", "job_name"] as const,
});

export const gqJobsDedupedTotal = new Counter({
  name: "gq_jobs_deduped_total",
  help: "Total number of jobs that were deduplicated (replaced existing staged job)",
  labelNames: ["queue_name"] as const,
});

export const gqJobsRetriedTotal = new Counter({
  name: "gq_jobs_retried_total",
  help: "Total number of intermediate retry attempts",
  labelNames: ["queue_name", "pipeline_name", "job_type", "job_name"] as const,
});

export const gqJobsExhaustedTotal = new Counter({
  name: "gq_jobs_exhausted_total",
  help: "Total number of jobs that exhausted all retry attempts",
  labelNames: ["queue_name", "pipeline_name", "job_type", "job_name"] as const,
});

export const gqJobsNonRetryableTotal = new Counter({
  name: "gq_jobs_non_retryable_total",
  help: "Total number of jobs that failed with non-retryable (critical) errors",
  labelNames: ["queue_name", "pipeline_name", "job_type", "job_name"] as const,
});

export const gqFastqPending = new Gauge({
  name: "gq_fastq_pending",
  help: "Number of jobs queued in fastq waiting to be processed",
  labelNames: ["queue_name"] as const,
});

export const gqFastqActive = new Gauge({
  name: "gq_fastq_active",
  help: "Number of jobs currently being processed by fastq workers",
  labelNames: ["queue_name"] as const,
});

// --- Delayed job metrics ---
export const gqJobsDelayedTotal = new Counter({
  name: "gq_jobs_delayed_total",
  help: "Total number of jobs staged with an intentional delay",
  labelNames: ["queue_name", "pipeline_name", "job_type", "job_name"] as const,
});

export const gqJobDelayMilliseconds = new Histogram({
  name: "gq_job_delay_milliseconds",
  help: "Duration of intentional delays applied to staged jobs",
  labelNames: ["queue_name", "pipeline_name", "job_type", "job_name"] as const,
  buckets: [100, 500, 1000, 2000, 5000, 10000, 30000, 60000],
});

// --- Retry metrics ---
export const gqRetryAttempt = new Histogram({
  name: "gq_retry_attempt",
  help: "Distribution of retry attempt numbers",
  labelNames: ["queue_name", "pipeline_name", "job_type", "job_name"] as const,
  buckets: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
});

export const gqRetryBackoffMilliseconds = new Histogram({
  name: "gq_retry_backoff_milliseconds",
  help: "Duration of retry backoff delays in milliseconds",
  labelNames: ["queue_name", "pipeline_name", "job_type", "job_name"] as const,
  buckets: [100, 500, 1000, 2000, 5000, 10000, 30000, 60000],
});

// --- Per-job duration metric ---
/**
 * Failed reads of the group retry-chain counter. A failed read returns 0, so a
 * sibling-led retry is indistinguishable from a genuine fresh delivery — it
 * resets the retry budget and makes the fold discard what the chain applied.
 */
export const gqGroupAttemptReadFailuresTotal = new Counter({
  name: "gq_group_attempt_read_failures_total",
  help: "Failed reads of the group retry-chain counter; a retry may read as a fresh delivery",
  labelNames: ["queue_name"] as const,
});

export const gqJobDurationMilliseconds = new Histogram({
  name: "gq_job_duration_milliseconds",
  help: "Duration of individual job processing in milliseconds",
  labelNames: ["queue_name", "pipeline_name", "job_type", "job_name"] as const,
  buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000],
});

// --- Oldest pending age gauge ---
export const gqOldestPendingAgeMilliseconds = new Gauge({
  name: "gq_oldest_pending_age_milliseconds",
  help: "Age of the oldest pending job in the ready sorted set (milliseconds)",
  labelNames: ["queue_name"] as const,
});

/**
 * Backlog age the eligible-waiting gauge is structurally blind to: a group
 * pinned in retry backoff has its ready score rewritten to now+backoff on every
 * failed attempt, so this gauge clocks off the per-group jobs zset instead,
 * whose scores survive retries/blocks/parks.
 */
export const gqOldestBacklogAgeMilliseconds = new Gauge({
  name: "gq_oldest_backlog_age_milliseconds",
  help: "Age of the oldest due job across sampled groups regardless of dispatch eligibility (catches groups pinned in retry backoff)",
  labelNames: ["queue_name"] as const,
});

/**
 * Deepest single group's staging hash, in staged jobs. The aggregate gauges
 * are blind to this: one group holding hundreds of thousands of fields looks
 * unremarkable to both of them (2026-06 incident: ~290k fields, ~2.9 GB).
 * Published from a rotating sweep — "deepest seen since this rotation began",
 * not "right now"; see `sweepStagingDepth` in metricsCollector.ts.
 */
export const gqGroupStagingDepthMax = new Gauge({
  name: "gq_group_staging_depth_max",
  help: "Staged jobs in the deepest single group seen in the current sweep rotation (catches one hot group accumulating behind unremarkable aggregates)",
  labelNames: ["queue_name"] as const,
});

/**
 * How many groups are at or above {@link STAGING_DEPTH_REPORT_FLOOR}.
 *
 * Separate from the max because they answer different questions under alarm.
 * One deep group is a hot key; a thousand is the drainer having stopped. The
 * max alone cannot tell those apart, and they want different responses.
 */
export const gqGroupsOverStagingDepth = new Gauge({
  name: "gq_groups_over_staging_depth",
  help: "Groups whose staging hash is at or above the reporting floor, in the current sweep rotation",
  labelNames: ["queue_name"] as const,
});

/**
 * Depth at which a group starts being counted as accumulating. Inclusive — a
 * group at exactly this depth is counted, since a round number is the one most
 * likely to be chosen deliberately. A reporting floor only: nothing in the
 * queue changes behaviour when a group crosses it.
 */
export const STAGING_DEPTH_REPORT_FLOOR = 10_000;

/**
 * Jobs whose producer supplied a ready score the queue refused. Raised at the
 * staging fallback the moment the value is rejected, before the bad score is
 * written — a post-hoc scan of the ready set would find nothing and report
 * zero forever. Excludes payloads scored at staging time by design (no
 * occurrence time supplied at all).
 */
export const gqReadyScoreImplausibleTotal = new Counter({
  name: "gq_ready_score_implausible_total",
  help: "Jobs staged with a producer score the queue rejected (not a timestamp, or outside the allowed skew around now) and replaced with the staging time",
  labelNames: ["queue_name"] as const,
});

// --- Blob lifecycle observability ---

/**
 * A stored blob exceeded the decode cap — possible tamper / zip-bomb.
 * Distinct from a missing blob.
 */
export const gqBlobDecodeCapExceededTotal = new Counter({
  name: "gq_blob_decode_cap_exceeded_total",
  help: "Blob read exceeded the decode byte cap — treated as missing (possible tamper / zip-bomb)",
  labelNames: ["queue_name"] as const,
});

/** Producer rejected a payload at the encode cap — bounds worker memory (ADR-026). */
export const gqPayloadTooLargeTotal = new Counter({
  name: "gq_payload_too_large_total",
  help: "Payload rejected at the encode cap",
  labelNames: ["queue_name"] as const,
});

/**
 * Claim-side poison guard parked a group into the blocked set
 * (specs/poison-group-park-guard.feature). reason:
 * "claim_strikes" = consecutive worker deaths while the group was in flight;
 * "oversized_payload" = staged value over the decode cap.
 */
export const gqGroupsPoisonParkedTotal = new Counter({
  name: "gq_groups_poison_parked_total",
  help: "Groups parked into the blocked set by a poison guard (reason: claim_strikes | oversized_payload | failure_streak)",
  labelNames: ["queue_name", "reason"] as const,
});

/**
 * Retry re-encode failed (transient blob-store 5xx, payload-too-large from a
 * state-bloat regression) — the retry never re-staged and the slot dropped to
 * the fail-safe. Distinct from `gqJobsNonRetryableTotal` (which is for genuine
 * non-retryable process() errors) so oncall can disambiguate "gave up on a
 * bad payload" from "gave up because encode blipped mid-retry".
 */
export const gqRetryEncodeFailuresTotal = new Counter({
  name: "gq_retry_encode_failures_total",
  help: "Retry re-encode failed — dispatched job completed via fail-safe and the job was DISCARDED (replay does not recover subscriber jobs; see gq_jobs_dropped_total)",
  labelNames: ["queue_name", "pipeline_name", "job_type", "job_name"] as const,
});

/**
 * A staged job we could not decode and therefore discarded (#5538): the drop
 * path used to call `scripts.complete()`, incrementing the same counter a
 * genuine success takes, so a discard read as a win. See `DecodeFailureReason`
 * for what each `reason` label means; a non-zero rate is permanent work loss
 * unless the owning application replays.
 */
export const gqJobsDroppedTotal = new Counter({
  name: "gq_jobs_dropped_total",
  help: "Staged jobs discarded because they could not be decoded",
  labelNames: ["queue_name", "pipeline_name", "job_type", "job_name", "reason"] as const,
});

export const gqJobsLastDroppedTimestampSeconds = new Gauge({
  name: "gq_jobs_last_dropped_timestamp_seconds",
  help: "Unix timestamp of the latest discarded job in this process. Detects the first discard without a previous counter sample; not durable across an unscraped process exit.",
  labelNames: [
    "queue_name",
    "pipeline_name",
    "job_type",
    "job_name",
    "reason",
  ] as const,
});

export function recordDroppedJob(labels: {
  queue_name: string;
  pipeline_name: string;
  job_type: string;
  job_name: string;
  reason: string;
}): void {
  gqJobsDroppedTotal.inc(labels);
  gqJobsLastDroppedTimestampSeconds.set(labels, Date.now() / 1000);
}

/**
 * A dispatched job whose routing metadata names a pipeline this worker has not
 * registered. Normal cause is a rolling deploy: old workers still poll the
 * queue and reject jobs for a pipeline they don't know, so a new-build worker
 * can take them. A burst ending with the deploy is expected; a rate that
 * outlives it means a pipeline was removed without a tombstone.
 */
export const gqJobsUnroutableTotal = new Counter({
  name: "gq_jobs_unroutable_total",
  help: "Dispatched jobs rejected because their pipeline is not registered in this worker (usually a mid-rollout build skew)",
  labelNames: ["queue_name", "pipeline_name", "job_type", "job_name"] as const,
});

/**
 * A release retired a blob's LAST lease, dropping its expiry from the 4-day
 * backstop to the release grace window. Liveness signal for reclaim: a rate
 * near zero while jobs complete means reclaim isn't happening — read beside
 * `gq_jobs_completed_total`. Scope: terminal retirement only, not the
 * dedup-squash release in `STAGE_LUA` — treat this count as a floor.
 */
export const gqBlobReleaseGraceTotal = new Counter({
  name: "gq_blob_release_grace_total",
  help: 'Blobs whose last lease was retired via terminal retirement, moving them from the 4-day backstop onto the release grace window (excludes the dedup-squash release path — a floor, not a total). The "tier" label is where the blob lived, not which provider stored it: "redis" or "s3", where "s3" means the durable object store whatever its scheme — an Azure Blob deployment reports "s3" here.',
  labelNames: ["queue_name", "tier"] as const,
});

/**
 * Every blob the reclaim runner examined, by outcome. Unlike
 * `gq_blob_release_grace_total`, outcomes partition the WHOLE keyspace, so
 * `sum by (outcome)` is a full picture, not a floor — the signal to read when
 * retention climbs anyway. `repaired` rising means releases are being missed;
 * `reclaimed` is the only outcome that frees bytes.
 */
export const gqBlobSweepTotal = new Counter({
  name: "gq_blob_sweep_total",
  help: "Blobs examined by the reclaim runner, by outcome (leased, repaired, reclaimed, bookkeeping, pending) — outcomes partition the keyspace, so this is a total, not a floor",
  labelNames: ["queue_name", "outcome"] as const,
});

/**
 * Drained siblings restaged because their `__jobName` differed from the
 * dispatched job's (ADR-066 mixed-command isolation) — distinct from the
 * batch-failure restage paths, which restage the whole batch. A steady rate
 * means genuinely mixed command traffic; a spike flags a group-key collision
 * or a misrouted producer.
 */
export const gqForeignSiblingsRestagedTotal = new Counter({
  name: "gq_foreign_siblings_restaged_total",
  help: "Drained siblings restaged untouched because their __jobName differed from the dispatched job (ADR-066 mixed-command isolation) — excludes the batch-failure restage paths",
  labelNames: ["queue_name"] as const,
});

/**
 * A coalesced batch failed retryably and was split in half to isolate the
 * cause. Increments ONCE PER SPLIT, not once per batch, so read it as a rate: a
 * steady non-zero rate means either the batch bound is too generous or a
 * payload in this pipeline is persistently unprocessable. Zero means batches
 * succeed whole or fail non-retryably.
 */
export const gqBatchBisectionsTotal = new Counter({
  name: "gq_batch_bisections_total",
  help: "Retryable coalesced-batch failures that were split in half to isolate the cause — increments once per split, so one failing batch costs several",
  labelNames: ["queue_name", "pipeline_name", "job_type", "job_name"] as const,
});
