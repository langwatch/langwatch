Feature: Data Retention service boundary

  Scenario: Resolve retention through the scope cascade
    Given an organization retention policy exists
    When the Data Retention service resolves a project
    Then the nearest policy for each category is returned

  Scenario: Reject invalid retention values
    When a caller sets a retention value that is not a whole week
    Then the Data Retention service rejects the mutation

  Scenario: Default a missing read target
    Given a retention read names a project that does not exist
    When the Data Retention service resolves that project
    Then the platform default is returned

  Scenario: Reject a missing write target
    Given a retention write names a project or team that does not exist
    When the Data Retention service resolves that scope
    Then a concrete domain or canonical dependency error is thrown

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

  Scenario: Pinning a trace does not change retention
    When a trace is pinned
    Then a PinnedTrace annotation is persisted
    And no ClickHouse retention command is issued

  Scenario: Manual pins survive share removal
    Given an auto-share pin was promoted to a manual pin
    When the share is removed
    Then the pin annotation remains

  Scenario: Apply retention to existing project data
    Given a project has a new resolved retention value
    When the Data Retention service triggers a retroactive update
    Then it routes the mutation through that project's ClickHouse tenant
    And it updates every table belonging to the requested category
