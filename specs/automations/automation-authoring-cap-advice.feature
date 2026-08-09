Feature: The authoring drawer warns before an automation outruns its daily ceiling

  As a customer authoring an automation
  I want to be told while I write the condition that it would match more
  traces a day than my plan allows
  So that I narrow it before it silently skips work all day

  # WHY THIS EXISTS. The daily ceiling (see
  # runaway-automation-containment.feature) is discovered after the fact: the
  # customer writes a condition, the automation runs, and the first they hear
  # of the ceiling is an email saying matches were skipped. The drawer already
  # counts how many traces the drafted condition matched over the last 7 days,
  # so it can say the same thing while the condition is still being written.
  #
  # ADVICE, NEVER A GATE. This never blocks saving and never changes what is
  # saved. The estimate is a 7-day extrapolation, the plan's ceiling is read
  # over the network, and both can be wrong or unavailable. A warning that
  # blocked Save on either would turn a rough estimate into a hard rule. So
  # every failure mode resolves the same way: say nothing, save as before.
  #
  # ONLY PERSIST ACTIONS. The ceiling governs actions that write a record per
  # match (add to dataset, add to annotation queue). Notify actions are bounded
  # by their digest cadence and the email caps instead, so warning about them
  # here would be wrong.

  Background:
    Given a user authoring a trace automation in a project
    And the condition preview counts the traces matched over the last 7 days

  Rule: The advice appears only when it is both true and relevant

    @integration
    Scenario: An over-ceiling condition on a persist action shows the advice
      Given the drafted action adds matched traces to a dataset
      And the preview implies more matches a day than the plan's ceiling
      When the preview settles
      Then the drawer warns that the condition is over the daily limit
      And it names the estimated matches a day and the plan's ceiling
      And it tells the customer to narrow the condition

    # Narrowing is not the only honest answer: the condition may be exactly
    # what the customer wants, and the ceiling follows the plan.
    @integration
    Scenario: The advice offers a way out that is not narrowing
      Given the drafted action adds matched traces to a dataset
      And the preview implies more matches a day than the plan's ceiling
      When the preview settles
      Then the warning offers a link to the plans page

    @integration
    Scenario: A condition within the ceiling renders no warning in the drawer
      Given the drafted action adds matched traces to a dataset
      And the preview implies fewer matches a day than the plan's ceiling
      When the preview settles
      Then no daily-limit warning is shown

    @integration
    Scenario: A notify action shows nothing even over the ceiling
      Given the drafted action sends a Slack message
      And the preview implies far more matches a day than the plan's ceiling
      When the preview settles
      Then no daily-limit warning is shown

    @unit
    Scenario: An over-ceiling condition on a persist action resolves to advice
      Given a persist-class action
      And an estimate above the plan's ceiling
      When the advice is resolved
      Then it carries the estimated matches a day and the ceiling

    @unit
    Scenario: A condition within the ceiling resolves to no advice
      Given a persist-class action
      And an estimate at or below the plan's ceiling
      When the advice is resolved
      Then there is no advice

    @unit
    Scenario: A notify action is never flagged against the ceiling
      Given a notify-class action
      And an estimate far above the plan's ceiling
      When the advice is resolved
      Then there is no advice

  Rule: A failure to estimate or to read the ceiling costs the customer nothing

    @integration
    Scenario: A failed preview shows nothing and never blocks saving
      Given the drafted action adds matched traces to a dataset
      And the condition preview fails
      When the drawer renders
      Then no daily-limit warning is shown
      And saving is unaffected

    @integration
    Scenario: A failed ceiling read shows nothing and never blocks saving
      Given the drafted action adds matched traces to a dataset
      And the preview implies more matches a day than any plan's ceiling
      And the plan's daily ceiling cannot be read
      When the preview settles
      Then no daily-limit warning is shown
      And saving is unaffected

    @unit
    Scenario: A failed estimate or ceiling read says nothing
      Given a persist-class action
      And either the estimate or the ceiling is missing
      When the advice is resolved
      Then there is no advice
