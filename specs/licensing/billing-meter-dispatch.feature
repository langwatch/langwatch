@integration
Feature: Billing Meter Dispatch
  As a SaaS billing system
  I want to report billable event usage to Stripe
  So that organizations are billed accurately for their consumption

  # ============================================================================
  # Usage Reporting Worker — Happy Path
  # ============================================================================

  @integration
  Scenario: Reports delta to Stripe when org has billable events
    Given I am in SaaS mode
    And an organization with a Stripe customer ID and active subscription
    And the organization has 150 billable events across all projects this month
    And the checkpoint shows 100 events previously reported
    When the usage reporting job runs for the organization
    Then it reports a delta of 50 events to Stripe
    And the checkpoint is updated to 150

  @integration
  Scenario: Aggregates events across all projects in the organization
    Given I am in SaaS mode
    And an organization with 3 projects
    And project A has 50 billable events, project B has 30, and project C has 20
    When the usage reporting job runs for the organization
    Then the total billable count is 100

  @integration
  Scenario: Self-re-triggers when delta is positive
    Given I am in SaaS mode
    And an organization with billable events exceeding the checkpoint
    When the usage reporting job runs and reports a positive delta
    Then it enqueues a delayed follow-up job for the organization

  @integration
  Scenario: Creates checkpoint on first run for a new organization
    Given I am in SaaS mode
    And an organization with no existing checkpoint
    And the organization has 50 billable events this month
    When the usage reporting job runs for the organization
    Then it reports a delta of 50 events to Stripe
    And a new checkpoint is created at 50

  # ============================================================================
  # Usage Reporting Worker — Skip Conditions
  # ============================================================================

  @integration
  Scenario: Skips when not in SaaS mode
    Given I am not in SaaS mode
    When the usage reporting job runs
    Then no usage is reported to Stripe

  @integration
  Scenario: Skips when organization has no Stripe customer ID
    Given I am in SaaS mode
    And an organization without a Stripe customer ID
    When the usage reporting job runs for the organization
    Then no usage is reported to Stripe

  @integration
  Scenario: Skips when organization has no active subscription
    Given I am in SaaS mode
    And an organization with a Stripe customer ID but no active subscription
    When the usage reporting job runs for the organization
    Then no usage is reported to Stripe

  @integration
  Scenario: Skips when delta is zero
    Given I am in SaaS mode
    And an organization with 100 billable events this month
    And the checkpoint shows 100 events previously reported
    When the usage reporting job runs for the organization
    Then no usage is reported to Stripe

  @integration
  Scenario: Skips when organization has no projects
    Given I am in SaaS mode
    And an organization with no projects
    When the usage reporting job runs for the organization
    Then no usage is reported to Stripe

  # ============================================================================
  # Usage Reporting Worker — Crash Recovery (Two-Phase Checkpoint)
  # ============================================================================

  @integration
  Scenario: Recovers from crash using pending checkpoint
    Given I am in SaaS mode
    And a checkpoint with a pending value of 200 from a previous crash
    And the checkpoint shows 100 events previously reported
    When the usage reporting job runs for the organization
    Then it reports a delta of 100 events to Stripe using the pending value
    And the idempotency key is deterministic based on the checkpoint values
    And the checkpoint is updated to 200 with pending cleared

  @integration
  Scenario: Catches up after crash recovery when count has grown
    Given I am in SaaS mode
    And a checkpoint with a pending value of 200 that was recovered
    And the current billable count is now 350
    When the worker recovers the pending checkpoint
    Then it first reports the pending delta with the original idempotency key
    And then self-re-triggers to catch the remaining difference

  @integration
  Scenario: Re-throws transient errors for worker retry
    Given I am in SaaS mode
    And the Stripe reporting service throws a transient error
    When the usage reporting job runs for the organization
    Then the error is re-thrown for the worker to retry

  @integration
  Scenario: Handles permanent Stripe rejection without updating checkpoint
    Given I am in SaaS mode
    And the Stripe reporting service returns a permanent rejection
    When the usage reporting job runs for the organization
    Then the checkpoint is not updated
    And the error is captured for alerting

  # ============================================================================
  # Billing Dispatch Reactor — Post-Fold Side Effect
  # ============================================================================

  @integration
  Scenario: Dispatch fires after fold succeeds
    Given a project belonging to an organization
    When a billable event fold completes successfully
    Then the reactor enqueues a usage reporting job for the organization

  @integration
  Scenario: Dispatch does not fire if fold fails
    Given a project belonging to an organization
    When the billable event fold fails
    Then no usage reporting job is enqueued

  @integration
  Scenario: Resolves organization from cache on subsequent events
    Given a project whose organization was previously resolved
    When another billable event fold completes for the same project
    Then the organization is resolved from cache without a DB query

  @integration
  Scenario: Skips orphan projects gracefully
    Given a project that does not belong to any organization
    When the billing dispatch reactor fires
    Then no job is enqueued
    And a warning is logged

  @integration
  Scenario: Skips silently when queue is unavailable
    Given the job queue is not available
    When the billing dispatch reactor fires
    Then no job is enqueued
    And no error is thrown

  @integration
  Scenario: Deduplicates concurrent events for the same organization
    Given multiple billable events for the same organization arrive rapidly
    When the billing dispatch reactor processes them
    Then only one reporting job is active for the organization

  # ============================================================================
  # Known Limitations (v1)
  # ============================================================================

  # - Fold/map race: Under heavy fold queue backlog, worker may read stale
  #   counts. Self-re-trigger catches up. Safety-net cron deferred to v2.
  # - TtlCache unbounded: No max-size cap. Stale entries evicted on get().
  #   Project-to-org mapping may be stale for up to TTL duration after transfers.
  # - Month boundary: Events near month-end may be reported under next billing
  #   cycle. Stripe billing period alignment handles this.
  # - Convergence: Self-re-trigger converges under normal load because the
  #   debounce window exceeds per-event processing time. Under sustained
  #   extreme load, jobs may chain indefinitely until load subsides.
