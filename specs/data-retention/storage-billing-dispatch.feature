Feature: Storage billing — dispatch sealed hours for measurement (ADR-027, Phase 4)
  As the storage-billing pipeline
  I want each org's newly-sealed hours measured and queued for reporting exactly once
  So that storage billing advances automatically without a cron or leader lock

  # An org-attributed event wakes the dispatcher, which catches the org's hourly cursor up to the
  # last COMPLETE wall-clock hour: for every sealed hour not yet measured it measures the billable
  # bytes, writes one StorageUsageHourly row (insert-if-absent), and enqueues one report command.
  # The whole thing is gated by a master flag (default OFF → fully inert), runs only for SaaS-billable
  # orgs, and is bounded at the Stripe timestamp ceiling. Stateless: the cursor is the durable table,
  # read per run, so it is correct across pods and restarts.

  # ---------------------------------------------------------------------------
  # Gating + short-circuit (zero work for orgs that should not be metered)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Metering disabled makes the dispatcher fully inert
    Given the storage-metering flag is off for the organization
    When the dispatcher runs for the organization
    Then no storage is measured
    And no row is written and no report is enqueued

  @unit
  Scenario: A non-billable organization is skipped before any measurement
    Given an organization with no Stripe customer or no active subscription
    When the dispatcher runs for the organization
    Then the billable-storage measurement is never queried
    And no row is written and no report is enqueued

  # ---------------------------------------------------------------------------
  # Cursor advance + gap fill
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A caught-up organization does no work
    Given an organization whose last measured hour is the most recent sealed hour
    When the dispatcher runs for the organization
    Then no new hour is measured and no report is enqueued

  @unit
  Scenario: Concurrent dispatches for the same organization are collapsed to one
    Given a dispatch already in progress for the organization
    When another of the organization's projects triggers a dispatch
    Then the second dispatch measures nothing
    And the heavy measurement is not re-run per project

  @unit
  Scenario: Every sealed hour since the cursor is measured and enqueued once
    Given an organization whose cursor trails the latest sealed hour by several hours
    When the dispatcher runs for the organization
    Then each missing sealed hour up to the latest is measured in order
    And one row is written and one report is enqueued per measured hour

  @unit
  Scenario: A brand-new organization starts at the latest sealed hour, not its whole history
    Given an organization that has never been measured
    When the dispatcher runs for the organization
    Then only the most recent sealed hour is measured
    And the organization's earlier history is not backfilled

  @unit
  Scenario: A gap beyond the billing ceiling is truncated with an alarm
    Given an organization whose cursor trails the latest sealed hour by more than the backfill ceiling
    When the dispatcher runs for the organization
    Then only the most recent hours up to the ceiling are measured
    And an alarm is logged that older hours were dropped

  # ---------------------------------------------------------------------------
  # Per-hour contract
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Each measured hour is rounded up to whole megabytes
    Given a sealed hour whose billable bytes are measured
    When the dispatcher records the hour
    Then the stored megabytes are the bytes rounded up to the next whole megabyte

  @unit
  Scenario: Recording an hour does not clobber one that already exists
    Given a sealed hour that was already measured and possibly already reported
    When the dispatcher records the same hour again
    Then the existing row is left untouched

  @unit
  Scenario: A measurement failure stops the run without skipping the hour
    Given a sealed hour whose measurement fails
    When the dispatcher runs for the organization
    Then the failing hour is not recorded and the run stops
    And later hours are not measured past the failure so no hour is silently skipped
