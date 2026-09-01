Feature: Shared Dashboard service
  Dashboard, builder graphs, and saved workbench charts share one process
  service while compatibility transports retain their existing URLs.

  @unit
  Scenario: A dashboard is created after the project's current dashboards
    Given the project has a dashboard at order 0
    When the Dashboard service creates a dashboard
    Then the new dashboard is assigned the next order

  @unit
  Scenario: A dashboard from another project cannot be renamed
    When the Dashboard service renames a dashboard outside the project
    Then it throws DashboardNotFoundError
    And it does not update a dashboard

  @unit
  Scenario: A graph is placed after every chart in the shared grid
    Given the dashboard has a chart at grid row 2
    When the Dashboard service creates a graph without a row
    Then the graph is assigned grid row 3

  @integration
  Scenario: Builder and workbench rows remain isolated
    When a graph operation reads a project
    Then it reads only rows with kind builder
    And saved workbench chart operations read only rows with kind workbench_sql

  @unit
  Scenario: Saved chart governance is called before persistence
    Given a saved chart policy is injected into Dashboard service
    When a saved workbench chart is created
    Then the policy validates its definition before the repository writes it

  @unit
  Scenario: Compatibility transports share one service instance
    When tRPC, REST, or RPC handles a Dashboard operation
    Then it reads DashboardService from process application context
    And it does not construct Prisma or a repository per request
