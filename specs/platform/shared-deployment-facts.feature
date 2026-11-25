Feature: A shared deployment fact is one exported leaf
  As the team composing a process from many owners
  I want a variable several owners read declared once, in @langwatch/config
  So that one meaning shared N ways parses and a second meaning still refuses at boot

  # ARCHITECTURE.md §6, layer 3: the parse admits a re-bound env var only when
  # the claimants are literally the same leaf.

  @unit
  Scenario: Owners sharing one deployment-fact leaf both parse it
    Given evaluation and workflow both hold the exported LANGEVALS_STAGING_TTL_SECONDS leaf
    When the process parses its config with that variable set
    Then each owner's slice carries the same parsed value

  @unit
  Scenario: A second leaf for a shared deployment fact still refuses
    Given evaluation holds the exported LANGEVALS_STAGING_TTL_SECONDS leaf
    And another owner declares its own leaf for LANGEVALS_STAGING_TTL_SECONDS
    When the process parses its config
    Then the parse refuses with config_collision naming both owners
