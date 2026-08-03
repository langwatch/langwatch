@integration
Feature: Updating evaluator settings keeps the canonical config shape
  As an agent or developer updating an evaluator's settings through the API or CLI
  I want the settings to land under config.settings with the evaluator type preserved
  So that the update actually takes effect instead of leaving stale settings behind

  # The failure this spec pins: `langwatch evaluator update <id> --settings
  # '<json>'` sent the parsed JSON as the whole `config` object, so the model,
  # prompt and other keys were merged at the TOP level of config while
  # config.settings kept the old defaults. The monitor kept evaluating with the
  # stale settings and the update silently did nothing effective. Found while
  # dogfooding with a customer project.

  Scenario: Updating settings replaces config.settings and preserves evaluatorType
    Given an evaluator with settings exists
    When I update the evaluator with new settings under config.settings
    Then config.evaluatorType is unchanged
    And config.settings equals the new settings
    And no settings keys appear at the top level of config

  @unit
  Scenario: The CLI sends --settings under config.settings
    When I run "langwatch evaluator update" with --settings JSON
    Then the update request body nests the parsed JSON under config.settings
