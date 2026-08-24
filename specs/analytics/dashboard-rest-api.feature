Feature: Dashboard REST API
  External tools and AI agents can manage dashboards programmatically
  via a REST API authenticated with project API keys.

  Background:
    Given I have a valid API key for a project

  Scenario: List dashboards
    Given the project has dashboards
    When I call GET /api/dashboards
    Then I receive all dashboards for the project ordered by position
    And each dashboard includes its graph count

  Scenario: Get a dashboard
    Given the project has a dashboard with graphs
    When I call GET /api/dashboards/:id
    Then I receive the dashboard with its graphs ordered by grid position

  Scenario: Create a dashboard
    When I call POST /api/dashboards with a name
    Then a new dashboard is created with auto-incremented order
    And I receive 201 Created

  Scenario: Rename a dashboard
    Given the project has a dashboard
    When I call PATCH /api/dashboards/:id with a new name
    Then the dashboard is renamed

  Scenario: Delete a dashboard
    Given the project has a dashboard with graphs
    When I call DELETE /api/dashboards/:id
    Then the dashboard and its graphs are deleted

  Scenario: Reorder dashboards
    Given the project has multiple dashboards
    When I call PUT /api/dashboards/reorder with an ordered list of IDs
    Then the dashboards are reordered accordingly

  Scenario: Plan limit enforcement on create
    Given the project has reached its dashboard limit
    When I call POST /api/dashboards
    Then I receive 403 Forbidden

  Scenario: Dashboard not found
    When I call GET /api/dashboards/:id with a non-existent ID
    Then I receive 404 Not Found

  Scenario: Unauthenticated request
    When I call GET /api/dashboards without an API key
    Then I receive 401 Unauthorized

  # The `kind` discriminator promises that neither chart shape sees the other's
  # rows. This is that promise on the way out: the reader serialises each graph
  # row wholesale, and a saved workbench chart's payload is the member's own
  # SQL. Tagged because it is a real exposure rather than a shape preference —
  # the rest of this file predates the binding convention.
  @integration
  Scenario: A saved workbench chart is not exposed through the dashboard REST API
    Given the project has a dashboard carrying both a builder graph and a saved workbench chart
    When I call GET /api/dashboards/:id
    Then I receive only the builder graph
    And the workbench chart's stored SQL appears nowhere in the response

  # The list's `graphCount` and the detail response's `graphs` array are two
  # views of the same resource, and the workbench chart is invisible to both
  # — see the exposure scenario above. Before this, the list counted the
  # workbench chart while the detail response omitted it, so a caller who
  # read graphCount and then fetched the detail saw a number the response
  # could never actually produce.
  @integration
  Scenario: The list's graphCount matches what the detail response actually returns
    Given the project has a dashboard carrying both a builder graph and a saved workbench chart
    When I call GET /api/dashboards/:id
    And I call GET /api/dashboards
    Then the list's graphCount for that dashboard equals the number of graphs in the detail response
