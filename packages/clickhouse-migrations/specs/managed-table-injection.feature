Feature: ClickHouse TTL reconciler manages the tables it is handed
  As the platform operator running schema migrations
  I want the retention-managed table list to be supplied by the composition
  So that the migration framework knows no feature module and still reconciles
  exactly the production tables

  @unit
  Scenario: The reconciler adds the retention TTL to a table it was handed
    Given a tiered table that carries no retention TTL
    And the reconciler is handed that table as managed
    When TTL reconciliation runs
    Then the table receives the retention DELETE clause

  @unit
  Scenario: The reconciler leaves a table it was not handed alone
    Given a table that carries no retention TTL
    And the reconciler is handed an empty managed list
    When TTL reconciliation runs
    Then no retention clause is issued for the table

  @unit
  Scenario: The migrate task passes the list it was created with to every endpoint
    Given a migrate task created with a managed table list
    When the task migrates the shared and a private endpoint
    Then each reconciliation receives that same list
