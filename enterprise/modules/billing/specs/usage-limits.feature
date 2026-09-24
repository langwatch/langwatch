Feature: Plan-limit and usage-warning notifications fire correctly

  Crossing a plan's allowance and approaching it are two different customer
  moments, each with its own notification. Both must be idempotent under
  concurrent workers and cooled down so a customer is never spammed for one
  crossing.

  # usage-limit.service.ts, usage-warning.service.ts, billing-alert-cooldown.service.ts,
  # entitlement/usage-limit-message.service.ts, entitlement/member-classification.service.ts

  @unit @unimplemented
  Scenario: Crossing the plan limit notifies the organization once
    Given an organization that has just crossed its plan's event allowance
    When the limit check runs
    Then the organization is notified once

  @unit @unimplemented
  Scenario: A second crossing inside the cooldown does not notify again
    Given an organization notified about its plan limit today
    When the limit check runs again the same day
    Then no second notification is sent

  @unit @unimplemented
  Scenario: Two concurrent limit checks send one notification, not two
    Given two workers checking the same organization's limit at the same time
    When both cross the threshold
    Then exactly one notification is recorded

  @unit @unimplemented
  Scenario: A warning fires before the limit, not after it
    Given an organization at the warning fraction of its allowance
    When the usage check runs
    Then a warning is sent and the organization is not yet blocked

  @unit @unimplemented
  Scenario: A resource limit names the resource the customer must act on
    Given an organization at its project limit
    When the limit check runs
    Then the notification names projects and what to do about it

  @unit
  Scenario: The usage warning carries main's severity and usage link
    Given an organization at 80% of its monthly limit
    When the usage-limit warning is built
    Then the mail is graded Medium, reads 80%, and links to the usage settings

  @unit
  Scenario: A usage warning below every threshold sends nothing
    Given an organization at 10% of its monthly limit
    When the usage-limit warning is checked
    Then no mail goes out and nothing is recorded
  @unit
  Scenario: The usage warning lists projects in the meter the caller resolved
    Given an organization metered in events above a warning threshold
    When the usage-limit warning is checked with the events meter
    Then the mail lists each named project's billable events, not its traces

  @unit
  Scenario: A usage warning for an organization that no longer exists sends nothing
    Given an organization that has been deleted
    When the usage-limit warning is checked
    Then nothing is sent and the check reports it was not sent

