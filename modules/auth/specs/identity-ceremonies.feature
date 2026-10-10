Feature: Better Auth row writes state their identity meaning
  @unit
  Scenario: Deleting a user erases their identity identifiers
    Given the composed Better Auth instance delegates its identity ceremonies to identity
    When Better Auth is about to delete a user
    Then identity is asked to erase that user before the row goes
