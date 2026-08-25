Feature: Data Retention service boundary

  Scenario: Resolve retention through the scope cascade
    Given an organization retention policy exists
    When the Data Retention service resolves a project
    Then the nearest policy for each category is returned

  Scenario: Reject invalid retention values
    When a caller sets a retention value that is not a whole week
    Then the Data Retention service rejects the mutation

  Scenario: Reject a missing scope target
    Given a retention read or write names a project or team that does not exist
    When the Data Retention service resolves that scope
    Then the canonical Project or Organization service error is thrown

  Scenario: Resolve scope ownership through canonical services
    Given a retention rule targets a project or team
    When the Data Retention service resolves its organization
    Then it uses the Project or Organization service
    And its repository reads only retention policy rows

  Scenario: Boot supplies the platform default
    Given the process has validated its retention configuration
    When it composes the Data Retention service
    Then it injects the platform default explicitly
    And importing the contract does not read environment state
