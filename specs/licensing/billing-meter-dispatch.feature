@integration
Feature: Billing Meter Dispatch

  # All scenarios in this file describe the SaaS-only billing usage
  # reporting worker (cross-project event aggregation, SaaS-mode skip,
  # crash recovery with two-phase checkpoint, transient-error retry,
  # event deduplication). Backend code lives in
  # ee/billing/services/usageReportingService and the billingMeterDispatch subscriber;
  # the integration-test fixture covers happy-path Stripe report submission
  # but not the worker-loop / recovery / dedup paths — all aspirational
  # pending the worker-test harness.

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
  # Billing Dispatch Subscriber — Post-Fold Side Effect
  # ============================================================================

  @integration @unimplemented
  Scenario: Deduplicates concurrent events for the same organization
    Given multiple billable events for the same organization arrive rapidly
    When the billing dispatch subscriber processes them
    Then only one reporting job is active for the organization

  # ============================================================================
  # Skip conditions: what is an anomaly, and what is Tuesday
  # ============================================================================

  # The dispatch is per active organization and takes no view on pricing, so
  # every organization reaches the reporting handler and most of them stop
  # there. Which of those stops deserves an operator's attention is the point
  # of these three.

  @unit
  Scenario: An organization that does not buy usage is skipped quietly
    Given an organization that is not on usage-based pricing
    When the usage reporting handler runs for it
    Then no usage is reported
    And the skip is recorded at debug, not as a warning

  @unit
  Scenario: A dispatch naming an organization that does not exist is a warning
    Given a dispatch for an organization id that no organization has
    When the usage reporting handler runs for it
    Then no usage is reported
    And the skip is recorded as a warning

  @integration
  Scenario: The billing lookup tells an absent organization from one that does not buy usage
    Given an organization on usage-based pricing and another on tiered pricing
    When the billing lookup runs for each of them and for an unused id
    Then it answers usage_billed, not_usage_billed, and not_found respectively

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
