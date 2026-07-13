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
  // ADR-030 hardening + review 2026-06-24
  "gq_blob_reclaim_s3_failures_total",
  "gq_blob_decode_cap_exceeded_total",
  "gq_envelope_gq2_downgrade_total",
  "gq_payload_too_large_total",
  "gq_groups_poison_parked_total",
  "gq_retry_encode_failures_total",
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
export const gqJobDurationMilliseconds = new Histogram({
  name: "gq_job_duration_milliseconds",
  help: "Duration of individual job processing in milliseconds",
  labelNames: ["queue_name", "pipeline_name", "job_type", "job_name"] as const,
  buckets: [
    1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000,
    120000,
  ],
});

// --- Oldest pending age gauge ---
export const gqOldestPendingAgeMilliseconds = new Gauge({
  name: "gq_oldest_pending_age_milliseconds",
  help: "Age of the oldest pending job in the ready sorted set (milliseconds)",
  labelNames: ["queue_name"] as const,
});

// --- Blob lifecycle observability (ADR-030 hardening + review 2026-06-24) ---

/** S3-tier reclaim throw (network / 5xx). Warn-only; TTL / bucket-lifecycle backstop. */
export const gqBlobReclaimS3FailuresTotal = new Counter({
  name: "gq_blob_reclaim_s3_failures_total",
  help: "Blob s3-tier reclaim failures (relies on TTL / bucket-lifecycle backstop)",
  labelNames: ["queue_name"] as const,
});

/** A stored blob exceeded the decode cap — possible tamper / zip-bomb. Distinct from a missing blob. */
export const gqBlobDecodeCapExceededTotal = new Counter({
  name: "gq_blob_decode_cap_exceeded_total",
  help: "Blob read exceeded the decode byte cap — treated as missing (possible tamper / zip-bomb)",
  labelNames: ["queue_name"] as const,
});

/** GQ2 encode fell back to GQ1 because tenant / tiered-store wiring was absent. */
export const gqEnvelopeGQ2DowngradeTotal = new Counter({
  name: "gq_envelope_gq2_downgrade_total",
  help: "GQ2 encode downgraded to GQ1 (tenant or tiered store missing at the composition root)",
  labelNames: ["queue_name"] as const,
});

/** Producer rejected a payload at the encode cap — bounds worker memory (ADR-030 §1). */
export const gqPayloadTooLargeTotal = new Counter({
  name: "gq_payload_too_large_total",
  help: "Payload rejected at the encode cap",
  labelNames: ["queue_name"] as const,
});

/**
 * Claim-side poison guard parked a group into the blocked set
 * (specs/event-sourcing/poison-group-park-guard.feature). reason:
 * "died_in_isolation" = the process died while this group's job ran solo
 * behind an isolation marker (the only strike-driven park; strikes alone
 * never park); "oversized_payload" = staged value over the decode cap.
 * Alert on spikes: every park is a tenant's group stalled until an operator
 * acts.
 */
export const gqGroupsPoisonParkedTotal = new Counter({
  name: "gq_groups_poison_parked_total",
  help: "Groups parked into the blocked set by the claim-side poison guard",
  labelNames: ["queue_name", "reason"] as const,
});

/**
 * Poison-guard isolation runs: a suspect group (claim strikes over the
 * threshold) executed while the worker quiesced all other work.
 * Outcomes: `cleared` (survived solo → innocent bystander healed),
 * `unattributed` (quiesce or marker write failed, ran without a marker so a
 * death could not be pinned on it), `deferred` (another isolation was in
 * progress; re-staged for a later solo run). A death during a marked
 * isolation run is observed on the NEXT claim as a park
 * (`gq_groups_poison_parked_total{reason="died_in_isolation"}`).
 */
export const gqPoisonIsolationRunsTotal = new Counter({
  name: "gq_poison_isolation_runs_total",
  help: "Suspect-group isolation runs by the claim-side poison guard",
  labelNames: ["queue_name", "outcome"] as const,
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
  help: "Retry re-encode failed — dispatched job completed via fail-safe, work recovers via event replay",
  labelNames: ["queue_name", "pipeline_name", "job_type", "job_name"] as const,
});
