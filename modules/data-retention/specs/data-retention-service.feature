Feature: Data Retention service boundary

  @unit
  Scenario: Resolve retention through the scope cascade
    Given an organization retention policy exists
    When the Data Retention service resolves a project
    Then the nearest policy for each category is returned

  @unit
  Scenario: Reject invalid retention values
    When a caller sets a retention value that is not a whole week
    Then the Data Retention service rejects the mutation

  @unit
  Scenario: Default a missing read target
    Given a retention read names a project that does not exist
    When the Data Retention service resolves that project
    Then the platform default is returned

  @unit
  Scenario: Reject a missing write target
    Given a retention write names a project or team that does not exist
    When the Data Retention service resolves that scope
    Then a concrete domain or canonical dependency error is thrown

  @unit
  Scenario: A retention rule aimed at a scope that no longer exists is refused by name
    Given the organization, team or project a retention override was aimed at has been removed
    When the reader saves the override
    Then the save is refused as a missing scope
    And the reader is told to reload the page and pick a scope that is still there

  @unit
  Scenario: A second retroactive update is refused while the first is still running
    Given a retroactive retention update is already rewriting this project's rows
    When the reader starts another one
    Then it is refused as already in progress
    And the refusal lists the updates the reader can wait for or stop

  @unit
  Scenario: A retention rule a caller has no standing to write is refused by name
    Given a reader who may change their own project but not the team
    When they save an override on the team
    Then the save is refused
    And the reader is told which permission that tier asks for

  @unit
  Scenario: A retention rule saved on a free plan is refused by name
    Given an organization on the free plan
    When a reader saves a retention override
    Then the save is refused as a paid capability
    And the reader is told their projects keep the platform default until the organization upgrades

  @unit
  Scenario: A retention rule saved from a project with no organization is refused by name
    Given the project the retention settings were opened from is no longer in an organization
    When the reader saves an override
    Then the save is refused as a missing project

  @unit
  Scenario: A retention length the plan does not offer is refused by name
    Given a plan that sells a fixed set of retention lengths
    When the reader saves a length that is not one of them
    Then the save is refused
    And the reader is told to choose one of the offered lengths

  @unit
  Scenario: A retention length under the plan's floor is told the floor
    Given a plan with a shortest sellable retention length
    When the reader saves a shorter one
    Then the save is refused
    And the reader is told the shortest length the plan allows

  @unit
  Scenario: A request to keep data forever is refused by name
    Given a reader who is not a platform administrator
    When they ask to keep data indefinitely
    Then the request is refused
    And the reader is told to pick a retention length instead

  @unit
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

  @unit
  Scenario: Pinning a trace does not change retention
    When a trace is pinned
    Then a PinnedTrace annotation is persisted
    And no ClickHouse retention command is issued

  @unit
  Scenario: Manual pins survive share removal
    Given an auto-share pin was promoted to a manual pin
    When the share is removed
    Then the pin annotation remains

  @unit
  Scenario: Apply retention to existing project data
    Given a project has a new resolved retention value
    When the Data Retention service triggers a retroactive update
    Then it routes the mutation through that project's ClickHouse tenant
    And it updates every table belonging to the requested category

  @unit
  Scenario: The memory and Postgres data retention repositories answer alike
    Given the same retention policies and trace pins written to each backend
    When the same reads and writes run against every backend
    Then each answers the same rows, the same absences, and never a row belonging to another organization or project
