@integration
Feature: Updating evaluator settings takes effect
  As an agent or developer updating an evaluator's settings through the API or CLI
  I want the new settings to actually take effect on the evaluator
  So that the next evaluation runs with what I configured instead of stale defaults

  # The failure this spec pins: `langwatch evaluator update <id> --settings
  # '<json>'` sent the parsed JSON in a shape the server merged as dead data,
  # so the evaluator kept running with its old settings and the update
  # silently did nothing effective. Found while dogfooding with a customer
  # project.

  Scenario: Updated settings take effect and the evaluator type is unchanged
    Given an evaluator with settings exists
    When I update the evaluator's settings
    Then the evaluator runs with the new settings
    And the evaluator's type is unchanged
    And none of the old settings linger

  @unit
  Scenario: Settings updated through the CLI take effect
    When I run "langwatch evaluator update" with --settings JSON
    Then the evaluator's stored settings become the provided JSON
