Feature: Dashboard widget definitions are validated before they are stored
  Every write surface for a dashboard widget validates its definition with the
  shared widget schema, so the REST routes accept exactly what the tRPC
  procedures accept, and a definition a read would refuse is never stored.

  @integration
  Scenario: Creating a widget over the API refuses a reserved or prototype parameter name
    Given a project key with permission to create dashboard widgets
    When it creates a widget whose query declares a parameter named "dashboard_context_since" or "__proto__"
    Then the request is refused as a validation error
    And the project's widget list stays empty

  @integration
  Scenario: Creating a widget over the API refuses a parameter default of the wrong type
    Given a project key with permission to create dashboard widgets
    When it creates a widget whose number parameter has the default "oops"
    Then the request is refused as a validation error
    And the project's widget list stays empty

  @integration
  Scenario: Updating a widget over the API refuses an invalid definition and keeps the stored one
    Given a dashboard widget saved in the project
    When a project key updates it with a query declaring a parameter named "constructor"
    Then the request is refused as a validation error
    And the widget reads back with its original definition

  @unit
  Scenario: The widget service refuses an invalid definition before writing it
    Given the dashboard widget service over the memory repository
    When it is asked to create a widget, or to update one, with a parameter named "prototype"
    Then it throws DashboardWidgetDefinitionRefusedError, a 422 customer refusal
    And the repository holds no invalid definition
