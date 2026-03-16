Feature: Remove label tag pills from suites UI
  As a LangWatch user
  I want the suites UI to not display label tag pills
  So that the interface is simpler with less visual noise

  # Labels are removed from all UI surfaces: sidebar cards, detail panel,
  # and the edit form. The data model is not modified.

  @integration
  Scenario: Suite sidebar cards do not display label tag pills
    Given a suite exists with labels "nightly" and "regression"
    When I view the suites sidebar
    Then the sidebar card for that suite does not show label tag pills

  @integration
  Scenario: Suite detail panel header does not display label tag pills
    Given a suite exists with labels "nightly" and "regression"
    When I open the suite detail panel
    Then the detail panel header does not show label tag pills

  @integration
  Scenario: Suite edit form does not display labels field
    Given a suite exists with labels "nightly" and "regression"
    When I open the suite edit form
    Then the labels field is not visible
