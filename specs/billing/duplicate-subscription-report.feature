# Read-only. Ported from main's scripts/report-duplicate-subscriptions.ts onto
# the task launcher. An organization is not supposed to hold two active
# subscriptions; while the rows agree the duplicate is invisible, and the
# moment they disagree the plan depends on row order.

Feature: Duplicate subscription report
  As someone answering a billing question about an account
  I want to see which organizations hold more than one active subscription
  So that I can tell whether a customer's plan depends on row order

  @unit
  Scenario: The duplicate-subscription report names the row plan resolution picks
    Given an organization holding two active subscriptions on different plans
    When the report runs
    Then it lists that organization with both rows and both plans
    And it marks the row plan resolution would pick, under the product's own ordering
    And it proposes nothing, because which row is the real contract is a billing decision

  @unit
  Scenario: The duplicate-subscription report censuses the pending backlog
    Given abandoned checkouts left as pending subscriptions
    When the report runs
    Then it counts them by plan, largest first
    And it names the oldest one, which is the signal that nothing expires them
