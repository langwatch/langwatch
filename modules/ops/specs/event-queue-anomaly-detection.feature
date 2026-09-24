Feature: Per-tenant rate anomaly detection
  As an operator running multi-tenant event-sourcing infrastructure
  I want to be notified when a single tenant's queue load spikes far
  above its own baseline
  So that a noisy neighbour (e.g. evaluator-recursion loop, accidental
  fan-out) can be caught within minutes rather than hours.

  # Why this exists — incident 2026-05-11
  #
  # The 2026-05-11 outage was caused by one tenant producing ~95% of
  # all event-sourcing groups after an evaluator-recursion loop. Cross-
  # tenant queue starvation lasted ~2h. The AnomalyDetector worker
  # surfaces these patterns on the Ops anomaly panel within minutes.
  #
  # Surface tier (10× baseline, sustained 5min): Ops panel + warning log.
  # Hard tier (100× baseline, sustained 15min): Ops panel + paged alert.
  #
  # Baseline = p95 of per-minute counts across a 7-day window.
  # Cached for 1h so the worker tick stays cheap on multi-tenant clusters.

  # Where the rates come from on this branch (ruled 2026-09-23): main counted
  # each tenant's jobs at enqueue, inside the GroupQueue. Here the queue-metrics
  # writer, which already scans every queue each 2s cycle under its fleet
  # lease, records each tenant's waiting jobs from that scan into the same
  # rate tracker. Window, tier and baseline constants are main's, unchanged.

  Background:
    Given the queue-metrics writer is recording each tenant's waiting jobs
    And the AnomalyDetector worker is running

  @unit @anomaly-detection @rates
  Scenario: The queue-metrics writer records each tenant's waiting jobs from its scan
    Given the writer's scan holds waiting jobs for tenants "proj_a" and "proj_b"
    When the writer's cycle runs
    Then both tenants are active for the detector
    And each tenant's count for this minute is its waiting jobs

  @unit @anomaly-detection @rates
  Scenario: A group id names its tenant before its first slash
    Given groups keyed "<tenant>/<job path>/<domain key>" and "<tenant>/job/<name>"
    And a group keyed by a bare id with no slash
    When the writer counts a scan's waiting jobs
    Then each keyed group counts toward the tenant before its first slash
    And the bare-id group counts toward no tenant

  @unit @anomaly-detection @rates
  Scenario: A backlog spike the writer sees surfaces through the detector
    Given two hours of steady backlog for "proj_runaway" and "proj_quiet"
    When "proj_runaway"'s backlog jumps tenfold for five minutes
    Then the detector surfaces a surface-tier anomaly for "proj_runaway" only

  # The observed rate is not main's enqueue rate, and these differences are
  # not hidden: a job waiting through N cycles counts N times (a minute is
  # ~30 cycles, so a minute's count is ~30x the average backlog); a job that
  # arrives and finishes between two scans counts zero; the scan samples 200
  # groups from each end of a queue's ready set plus 200 blocked groups, so
  # groups beyond the sample go unseen; and a tenant's parked groups are not
  # in the scan. The tiers compare a tenant with its own baseline, so the
  # constant factor cancels; MIN_BASELINE_RATE (5/min) now means an average
  # backlog of about one sixth of a job.
  @unit @anomaly-detection @rates
  Scenario: A job waiting across cycles is counted in every cycle, where main counted it once at enqueue
    Given tenant "proj_a" has one job waiting
    When the writer scans twice before it is processed
    Then "proj_a"'s count for this minute is two

  @unit @anomaly-detection @kill-switch
  Scenario: Kill-switch FF disables anomaly detection for one tenant without a redeploy
    Given the PostHog flag "es-observability-anomaly-detection-killswitch" is enabled for tenant "proj_killed"
    And tenant "proj_normal" has no kill-switch flag
    When the AnomalyDetector tick runs
    Then tenant "proj_killed" is skipped and counted in skippedKillSwitch
    And tenant "proj_normal" is still evaluated normally

  @unit @anomaly-detection @kill-switch
  Scenario: Kill-switch fails open when PostHog is unavailable
    Given the PostHog feature-flag service throws on every isEnabled call
    When the AnomalyDetector tick runs for an active tenant
    Then the tenant IS evaluated (PostHog outage must not silently disable observability)

  @unit @anomaly-detection @kill-switch
  Scenario: Kill-switch FF makes the rate tracker record() a no-op on the hot path
    Given the PostHog flag is enabled for tenant "proj_killed"
    When the rate tracker records waiting jobs for tenant "proj_killed"
    Then no Redis write is issued and the tenant does not appear in the active-tenants index

  @unit @anomaly-detection @baseline-cache
  Scenario: Baseline cache hit avoids re-scanning the 7-day series
    Given tenant "proj_acme" has a cached baseline of 10/min
    When the AnomalyDetector tick runs
    Then the 7-day perMinuteSeries is not fetched
    And evaluation proceeds against the cached baseline

  @unit @anomaly-detection @baseline-cache
  Scenario: Baseline cache miss triggers a fresh p95 computation and stores it
    Given tenant "proj_acme" has 7 days of activity with stable rate
    And no baseline is cached
    When the AnomalyDetector tick runs
    Then the p95 baseline is computed from the per-minute series
    And the result is written to Redis with a 1h TTL

  @unit @anomaly-detection @baseline-cache
  # A fleet of quiet tenants re-reading its full minute series every 1-minute
  # tick was the dominant Redis engine-CPU cost (2026-07-09). The verdict is
  # cached briefly — far shorter than the 1h baseline TTL — so a ramping tenant
  # still gets its first baseline within minutes.
  Scenario: Insufficient history is cached briefly so quiet tenants are not re-read every tick
    Given tenant "proj_new" has only 3 minutes of activity
    When the AnomalyDetector tick runs
    Then the tenant is skipped this tick
    And the not-enough-data verdict is cached with a short expiry, well under the baseline's 1h cache TTL

  # Main ticked on every worker replica with no leader; a scheduled process
  # wakes once across the fleet, so each tick runs on one worker.
  @unit @anomaly-detection @schedule
  Scenario: Anomaly detection ticks once a minute as a scheduled process
    Given Ops's anomaly detection pipeline is installed
    When the schedule wakes
    Then one detection is asked for, keyed by that wake
    And the next wake comes sixty seconds later

  @unit @anomaly-detection @schedule
  Scenario: A redelivered detection surfaces a runaway tenant once
    Given tenant "proj_runaway" is running at a hundred times its baseline
    When the same detection is delivered twice
    Then one hard-tier anomaly is recorded for "proj_runaway"
    And the hard-tier alert goes out once

  @unit @anomaly-detection @schedule
  Scenario: A failed detection tick waits for the next wake
    Given the detector fails on its first tick
    When the detection is delivered
    Then the delivery settles without an error
    And the next wake runs detection again
