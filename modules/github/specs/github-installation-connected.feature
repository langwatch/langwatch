Feature: GitHub records that an installation was connected
  Connecting an installation is GitHub's own fact, recorded on its github_lifecycle
  pipeline; peers such as Coding Agent react from their own side (ARCHITECTURE.md §9).

  @unit
  Scenario: a completed installation records that it was connected
    Given github_lifecycle is registered in the process
    When an installation is connected to an organization
    Then GitHub sends one installation connected fact carrying only ids, keyed to the organization

  @unit
  Scenario: a redelivered installation connected command records nothing new
    Given an installation connected command
    When the command is handled twice
    Then both events carry one idempotency key

  @unit
  Scenario: an installation connect outside a registered pipeline is refused by name
    Given github_lifecycle is not registered in the process
    When an installation is connected to an organization
    Then the record fails naming github_lifecycle
