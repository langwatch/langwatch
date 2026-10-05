Feature: The suppression-states-why lint rule
  The house `langwatch/*` rules state the architecture, so they are strict: a
  disable directive naming one is itself an error. A rule whose framework may
  genuinely not cover a case opts in through `defineRule({ escape })`; a disable
  naming it must say, in a sentence of at least five real words, why the
  framework cannot be used, and its message tells the agent to ask the human
  when the case is confusing. Directives for other plugins' rules are untouched.

  @unit
  Scenario: A disable naming a strict house rule is reported
    Given a file with "oxlint-disable-next-line langwatch/strict-rule -- <a real reason>"
    And strict-rule did not opt in to a disable
    When the rule runs
    Then houseRuleDisabled is reported at the directive's line
    And the message tells the agent to change the code or ask the human

  @unit
  Scenario: A bare disable of an escapable rule is reported
    Given a rule that opted in to a disable
    And a directive naming it with no "-- reason"
    When the rule runs
    Then reasonMissing is reported

  @unit
  Scenario: A placeholder reason is reported
    Given a directive naming an escapable rule with "-- todo", "-- temporary", "-- fix later", "-- legacy" or "-- false positive"
    When the rule runs
    Then reasonVague is reported with the reason quoted

  @unit
  Scenario: A disable of an escapable rule with a real reason passes
    Given a directive naming an escapable rule with a reason of five or more real words
    When the rule runs
    Then nothing is reported

  @unit
  Scenario: A disable of another plugin's rule is left alone
    Given directives naming only react-hooks, eslint core or no rule at all
    When the rule runs
    Then nothing is reported

  @unit
  Scenario: An escapable rule's message ends with the one escape sentence
    Given a rule declared with escape naming its framework
    When its messages are built
    Then each prints what, then fix, then one sentence: extend the framework or disable with why, and ask the human if confused

  @unit
  Scenario: A house rule's message carries no escape sentence
    Given a rule declared without escape
    When its messages are built
    Then they print what and fix alone

  @unit
  Scenario: No house rule opts in to a disable yet
    Given the registered plugin
    When its rules are read
    Then the suppression rule is registered
    And no existing rule accepts a disable
