Feature: Remove label tag pills from suites UI
  As a LangWatch user
  I want the suites UI to not display label tag pills
  So that the interface is simpler with less visual noise

  # Labels exist in the data model and can still be managed via the edit form,
  # but the TagList rendering is removed from both the sidebar cards and the
  # detail panel header.

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
  Scenario: Suite edit form still allows managing labels
    Given a suite exists with labels "nightly" and "regression"
    When I open the suite edit form
    Then the labels field is available for editing
