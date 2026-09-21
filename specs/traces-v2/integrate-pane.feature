Feature: Integrate pane
  As a developer opening a project that has never received a trace
  I want one clear path to send my first trace
  So that I can instrument my agent without reading a wall of options

  The traces page replaces its table with this pane while the project
  has no traces. The pane mints an access token first, then offers the
  ways forward under it: hand the setup to an agent, read the SDK
  instructions, or look at sample data before writing any code. The
  setup paths are actions, not a tab strip, so the page carries one
  thing to read at a time.

  @integration
  Scenario: The pane leads with the token and keeps its actions under it
    Given I open a project that has no traces
    Then the title comes first, then the access token area
    And the actions sit under the access token area

  @integration
  Scenario: The setup paths are not a tab strip
    Given I open a project that has no traces
    Then no Skills, MCP, Prompt or SDK tab strip renders

  @integration
  Scenario: The SDK instructions open and close from their own button
    Given I open a project that has no traces
    When I press "See SDK instructions"
    Then the SDK platform picker appears under the actions
    When I press "See SDK instructions" again
    Then the SDK instructions are hidden
