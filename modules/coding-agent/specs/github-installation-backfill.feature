Feature: Coding Agent backfills pull request mappings when GitHub connects
  GitHub records that an installation was connected as its own fact. Coding Agent
  reacts from its own side; GitHub holds no Coding Agent dependency (ARCHITECTURE.md §9).

  @unit
  Scenario: connecting an installation backfills pull request mappings
    Given the coding-agent pipeline is composed with its installation backfill
    When GitHub records that an installation was connected for an organization
    Then Coding Agent backfills that organization's recent session branches

  @unit
  Scenario: a redelivered installation connect is harmless
    Given the coding-agent pipeline is composed with its installation backfill
    When the same installation connected fact is delivered twice
    Then both deliveries share one deduplication identity
    And the second backfill asks GitHub for exactly the branches the first did
