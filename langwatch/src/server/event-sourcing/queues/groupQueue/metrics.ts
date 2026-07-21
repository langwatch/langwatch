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
  // #5538
  "gq_jobs_dropped_total",
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
  help: "Retry re-encode failed — dispatched job completed via fail-safe and the job was DISCARDED (replay does not recover reactor jobs; see gq_jobs_dropped_total)",
  labelNames: ["queue_name", "pipeline_name", "job_type", "job_name"] as const,
});

/**
 * A staged job we could not decode and therefore discarded (#5538).
 *
 * Why this exists at all: the drop path used to be silent. It called
 * `scripts.complete()`, whose Lua INCRs the same `stats:completed` counter a
 * genuine success takes — so a discarded job did not merely go unnoticed, it was
 * counted as a WIN and cleared the group's stored error on the way out. Nothing
 * else in this module distinguishes "processed it" from "threw it away".
 *
 * Why the full label set and not just `{queue_name, reason}`: a bare queue label
 * pages oncall with "event-sourcing/jobs dropped 100" and cannot say WHICH
 * pipeline lost WHAT. The difference between a dropped UI broadcast and a dropped
 * `governanceOcsfEventsSync` (OCSF audit) or `gatewayBudgetSync` (billing) event
 * is the difference between a shrug and a compliance incident. Labels are read
 * off the envelope header via `readJobRoutingMeta`, which survives a body we
 * cannot decode.
 *
 * `reason` (see `DecodeFailureReason`, plus this module's terminal reasons):
 * - `missing_blob` — the body is GONE. Irreducible loss: no retry, park, or
 *   replay resurrects it.
 * - `malformed_envelope` / `body_unreadable` — the body is PRESENT but
 *   unreadable to this worker. Its value is deliberately NOT released, so a
 *   later worker (post-rollout) can still read it.
 * - `transient_exhausted` — the blob store stayed unreachable for every retry.
 * - `sibling_restage_failed` — a coalesced sibling could not be re-staged.
 * - `retry_encode_failed` — a retry's re-encode failed, so the retry never went
 *   back. Also counted by `gq_retry_encode_failures_total`, which stays as the
 *   specific diagnostic; this counter is the complete ledger of discards.
 * - `unknown` — an unclassified throw. Non-zero here means a decode failure mode
 *   exists that we have not named; that is a bug in the enum, not a shrug.
 *
 * ⚠️ A non-zero rate on a reactor pipeline is PERMANENT DATA LOSS, not a blip.
 * Replay rebuilds fold projections and never invokes reactors
 * (`projections/projectionRouter.ts:61-71`), so nothing re-fires a dropped
 * reactor job. This counter is the ONLY signal that it happened.
 */
export const gqJobsDroppedTotal = new Counter({
  name: "gq_jobs_dropped_total",
  help: "Staged jobs discarded because they could not be decoded — for reactor pipelines this is permanent data loss (replay does not re-invoke reactors)",
  labelNames: [
    "queue_name",
    "pipeline_name",
    "job_type",
    "job_name",
    "reason",
  ] as const,
});
