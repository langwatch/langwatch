Feature: Scenario run status config lives with UI components
  As a developer
  I want the scenario run status display config to live outside the server directory
  So that UI concerns are not mixed with server-side code

  Background:
    The scenario run status config maps each status to its display properties
    (color, label, icon) and is consumed by simulation UI components.

  @unit
  Scenario: Lucide-react icon mapping is colocated with the status config
    Given the scenario run status config module
    Then it exports a status-to-icon mapping for every ScenarioRunStatus value
    And the icon mapping uses lucide-react icon components

  @unit
  Scenario: Config covers every ScenarioRunStatus value
    Given the ScenarioRunStatus enum
    When looking up the status config for each enum value
    Then every status has a colorPalette, label, isComplete flag, and fgColor
