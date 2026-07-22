Feature: Silencing a rule

  Silence is a temporary mute: the rule keeps evaluating and keeps its
  history honest, but its effects — notifications and persist actions —
  are suppressed until the silence expires. It is the incident view's
  "shut it up for a bit", distinct from disabling, which is the permanent
  off-switch.

  See dev/docs/adr/063-automations-domain-packages-customer-api-and-agent-surface.md.

  Background:
    Given a project with an alert rule that is firing

  Rule: Silence suppresses effects, not evaluation

    Scenario: A silenced alert stops notifying
      When the user silences the rule for an hour
      Then no notifications are delivered while the silence lasts

    Scenario: A silenced rule still tracks what happened
      Given the rule is silenced
      When matching activity continues
      Then the rule's firing state stays current
      And the history records that fires were suppressed by the silence

    Scenario: A silenced on-trace rule stops acting
      Given an on-trace rule that adds traces to a dataset is silenced
      When a matching trace arrives
      Then nothing is added to the dataset while the silence lasts

  Rule: Silence expires on its own

    Scenario: Effects resume when the silence ends
      Given the rule was silenced for an hour
      When the hour passes and the condition still holds
      Then notifications resume without user action

    Scenario: Un-silencing early restores effects immediately
      Given the rule is silenced
      When the user removes the silence
      Then effects resume immediately

  Rule: Silence is visible everywhere the rule is

    Scenario: The list shows the silence and its remaining time
      Given the rule is silenced
      Then the rule's row shows it is silenced and roughly how long remains

    Scenario: Silence is available to API callers
      Given a caller using the customer API
      When the caller silences the rule until a stated time
      Then the rule reports itself silenced until that time
      And the caller can remove the silence

  Rule: Silence and disable stay distinct

    Scenario: Disabling is not silencing
      Given the rule is disabled
      Then it does not evaluate at all
      And it is presented as off, not silenced

    Scenario: A silence does not outlive its purpose
      Given the rule is silenced
      When the rule is edited
      Then the silence remains in force until it expires or is removed
