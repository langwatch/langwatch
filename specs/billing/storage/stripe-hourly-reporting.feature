Feature: Storage billing hourly reporting to Stripe
  As a billing system
  I report each organization's hourly stored megabytes to Stripe exactly once
  So that customers are invoiced 3 EUR per GiB-month of billable storage, never double-charged

  # ADR-039 phase 4 of 4: the money path. Gated per organization —
  # only flipped on after seeding has run and audits are clean.

  Background:
    Given the organization has storage billing enabled

  @integration @unimplemented
  Scenario: Each organization hour is reported exactly once
    Given an hourly row that was already reported
    When the reporter runs again over the same hour
    Then no Stripe meter event is sent for it

  @integration @unimplemented
  Scenario: Zero-usage hours are settled without a Stripe call
    Given an hourly row of 0 megabytes
    When the reporter processes it
    Then the row is marked reported
    And no Stripe meter event is sent

  @integration @unimplemented
  Scenario: A resent meter event is deduplicated by Stripe
    Given a meter event that was sent but whose confirmation was lost
    When the reporter retries the same organization hour
    Then the resent event carries the same deterministic identifier
    And Stripe records the usage once

  @integration @unimplemented
  Scenario: A Stripe failure leaves the hour unreported for retry
    Given Stripe rejects a meter event with a transient error
    When the reporter processes the hour
    Then the row is not marked reported
    And the next run retries it

  @integration @unimplemented
  Scenario: Hours older than the Stripe backdate ceiling are settled without reporting
    Given an unreported hourly row older than 35 days
    When the reporter processes it
    Then the row is marked as too old to report
    And an alert records the skipped usage

  @integration @unimplemented
  Scenario: Organizations without the billing gate are never reported
    Given an organization with hourly rows but storage billing disabled
    When the reporter runs
    Then no Stripe meter events are sent for that organization

  @unit @unimplemented
  Scenario: A full month of steady storage invoices at 3 EUR per GiB
    Given an organization holding a steady 8 GiB billable for a 30-day month
    When all hourly reports for the month are summed by the Stripe meter
    Then the invoice line totals approximately 24 EUR
