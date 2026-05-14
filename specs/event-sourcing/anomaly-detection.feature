Feature: Per-tenant rate anomaly detection
  As an operator running multi-tenant event-sourcing infrastructure
  I want to be notified when a single tenant's enqueue rate spikes far
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

  Background:
    Given the GroupQueue is recording per-tenant enqueues
    And the AnomalyDetector worker is running

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
    When the GroupQueue records an enqueue for tenant "proj_killed"
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
  Scenario: Insufficient history is NOT cached so the tenant is re-checked soon
    Given tenant "proj_new" has only 3 minutes of activity
    When the AnomalyDetector tick runs
    Then no baseline is cached for "proj_new"
    And the tenant is skipped this tick
