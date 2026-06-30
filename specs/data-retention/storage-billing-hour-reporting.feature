Feature: Storage billing — report a sealed hour to Stripe (ADR-027, Phase 3)
  As the storage-billing pipeline
  I want to report each measured hour's storage to Stripe exactly once, additively
  So that an organization's invoice reflects MiB-hours of data kept beyond the free window

  # A measured hour (organization + sealed UTC hour + integer megabytes) is reported as one
  # additive meter event into a `sum` meter — the raw hourly value IS the integral, sent once and
  # never recomputed (NOT a gauge / last-value set, which would telescope and be gameable by deleting
  # late in the period). Idempotency is the hour's own "reported" marker (the durable cursor) plus a
  # deterministic Stripe identifier; a separate per-month checkpoint carries ONLY the circuit breaker.
  # Decision (2026-06-30): the checkpoint is breaker-only — the (org, month) row cannot disambiguate
  # which hour was in flight, so crash-recovery is the per-hour cursor, not a checkpoint accumulator.

  # ---------------------------------------------------------------------------
  # Happy path + additive contract
  # ---------------------------------------------------------------------------

  @unit
  Scenario: An unreported hour is reported additively and marked reported
    Given an organization with a Stripe customer and an active subscription
    And a measured hour that has not yet been reported
    When the hour is reported
    Then exactly one additive meter event is sent for that hour's megabytes
    And the hour is marked reported so it is never sent again

  @unit
  Scenario: The reported value is the hour's integer megabytes
    Given a measured hour of a known integer megabyte size
    When the hour is reported
    Then the value sent to billing equals that integer megabyte count
    And no gigabyte conversion or fractional value is applied on our side

  @unit
  Scenario: The billing identifier is deterministic per organization and hour
    Given the same organization and sealed hour reported twice
    When each report builds its billing identifier
    Then both produce the same identifier so billing counts the hour once

  # ---------------------------------------------------------------------------
  # Idempotency (the reported cursor)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: An hour already marked reported is not reported again
    Given a measured hour that is already marked reported
    When the hour is reported
    Then no meter event is sent
    And the hour's reported state is left unchanged

  @unit
  Scenario: A Stripe duplicate is treated as already reported
    Given a measured hour whose meter event already exists on Stripe
    When the hour is reported
    Then the duplicate is treated as a successful report
    And the hour is marked reported without raising a failure

  # ---------------------------------------------------------------------------
  # Failure handling + circuit breaker
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A permanent rejection does not mark the hour reported
    Given a measured hour that Stripe permanently rejects
    When the hour is reported
    Then the hour is left unreported so a later run can retry
    And the consecutive-failure count is increased
    And no retry is self-dispatched for a permanent rejection

  @unit
  Scenario: A transient error increases the failure count and retries
    Given a measured hour whose report hits a transient billing error
    When the hour is reported
    Then the consecutive-failure count is increased
    And a retry of the same hour is self-dispatched
    And the error is not propagated to the queue framework

  @unit
  Scenario: The breaker stops reporting after too many consecutive failures
    Given an organization whose consecutive-failure count is at the breaker threshold
    When an hour is reported
    Then no meter event is sent
    And no retry is self-dispatched until the failure is investigated

  @unit
  Scenario: A success below the breaker threshold clears the failure count
    Given an organization with some prior consecutive failures below the threshold
    And a measured hour that has not yet been reported
    When the hour is reported successfully
    Then the consecutive-failure count is cleared

  # ---------------------------------------------------------------------------
  # Skip conditions
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Reporting is skipped for an organization that cannot be billed
    Given an organization with no Stripe customer or no active subscription
    When an hour is reported
    Then no meter event is sent

  @unit
  Scenario: Reporting is a no-op when no measured hour exists
    Given an organization with no measured row for the requested hour
    When the hour is reported
    Then no meter event is sent
    And nothing is marked reported
