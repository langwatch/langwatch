Feature: The generated lint-rule reference
  Every rule the langwatch oxlint plugin registers is described in one
  generated file, so a reader can see what a rule reports and how to satisfy
  it without opening the rule. The file is rendered from the rule declarations
  themselves, so it cannot drift from them.

  @unit
  Scenario: The committed reference matches the render
    Given the checked-in dev/docs/lint-rules.md
    When the reference is rendered from the plugin registry
    Then the committed file matches the render

  @unit
  Scenario: A changed rule message no longer matches the committed reference
    Given a rule whose fix sentence has been rewritten
    When the reference is rendered from the plugin registry
    Then the render no longer matches the committed file

  @unit
  Scenario: A rule without a spec renders as none yet
    Given a rule with no specs/tooling feature file
    When the reference is rendered from the plugin registry
    Then the rule's spec line reads none yet
