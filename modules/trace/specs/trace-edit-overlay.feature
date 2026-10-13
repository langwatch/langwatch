Feature: Trace edit overlay storage

  @integration
  Scenario: The memory and Postgres trace edit overlay repositories answer alike
    Given the memory and the Postgres trace edit overlay repositories
    When each is asked about the same corrections
    Then they answer alike
