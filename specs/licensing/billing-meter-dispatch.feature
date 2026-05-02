@integration
Feature: Billing Meter Dispatch
  As a SaaS billing system
  I want to report billable event usage to Stripe
  So that organizations are billed accurately for their consumption

  # ============================================================================
  # Usage Reporting Worker — Happy Path
  # ============================================================================

  @integration @unimplemented
  Scenario: Aggregates events across all projects in the organization
    Given I am in SaaS mode
    And an organization with 3 projects
    And project A has 50 billable events, project B has 30, and project C has 20
    When the usage reporting job runs for the organization
    Then the total billable count is 100

  # ============================================================================
  # Usage Reporting Worker — Skip Conditions
  # ============================================================================

  @integration @unimplemented
  Scenario: Skips when not in SaaS mode
    Given I am not in SaaS mode
    When the usage reporting job runs
    Then no usage is reported to Stripe

  @integration @unimplemented
  Scenario: Skips when organization has no projects
    Given I am in SaaS mode
    And an organization with no projects
    When the usage reporting job runs for the organization
    Then no usage is reported to Stripe

  # ============================================================================
  # Usage Reporting Worker — Crash Recovery (Two-Phase Checkpoint)
  # ============================================================================

  @integration @unimplemented
  Scenario: Catches up after crash recovery when count has grown
    Given I am in SaaS mode
    And a checkpoint with a pending value of 200 that was recovered
    And the current billable count is now 350
    When the worker recovers the pending checkpoint
    Then it first reports the pending delta with the original idempotency key
    And then self-re-triggers to catch the remaining difference

  @integration @unimplemented
  Scenario: Re-throws transient errors for worker retry
    Given I am in SaaS mode
    And the Stripe reporting service throws a transient error
    When the usage reporting job runs for the organization
    Then the error is re-thrown for the worker to retry

  # ============================================================================
  # Billing Dispatch Reactor — Post-Fold Side Effect
  # ============================================================================

  @integration @unimplemented
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
