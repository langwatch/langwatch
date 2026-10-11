Feature: The analytics overview lists the project's custom dashboards as links

  Each dashboard on the overview is one tile that opens that dashboard.

  @integration
  Scenario: A dashboard tile is one link named for the dashboard
    Given a project with a custom dashboard "Latency"
    When the overview lists the custom dashboards
    Then the tile is one link named "Open Latency"
    And the link points at that dashboard's report page

  @integration
  Scenario: Choosing a dashboard tile goes to the dashboard once
    Given a project with a custom dashboard "Latency"
    When the reader activates the "Latency" tile
    Then the reader goes to that dashboard's report page
