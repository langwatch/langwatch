Feature: Model providers scope filter
  As a user managing model providers across an organization
  I want to filter the providers list by the scope they're attached to
  So that I can see what's set at the org, team, or current project, instead of being limited to one view

  Background:
    Given I am logged in
    And I have access to an organization with at least one team and project
    And I have providers attached at organization, team, and project scopes

  # ============================================================================
  # Default view: everything I can see
  # ============================================================================

  @integration
  Scenario: The default view shows every provider I have access to across scopes
    When I open the model providers settings page
    Then the filter at the top right reads "All you can see"
    And the list includes providers attached at the organization, team, and project scope
    And each row shows scope chips for the scope(s) the provider belongs to

  # ============================================================================
  # Scope filters
  # ============================================================================

  @integration
  Scenario: Filtering by "Organization" hides team- and project-only rows
    When I change the scope filter to "Organization"
    Then the list shows only providers attached at the organization scope
    And providers attached only to a team or a project are hidden

  @integration @unimplemented
  Scenario: Filtering by a specific team hides org and other-team rows
    When I change the scope filter to team "platform"
    Then the list shows only providers attached to team "platform"
    And providers attached at the organization or to a different team are hidden

  @integration
  Scenario: Filtering by "This project" hides everything not attached to the current project
    When I change the scope filter to "This project"
    Then the list shows only providers attached to the current project
    And inherited org/team providers are hidden from the list

  # ============================================================================
  # Empty states
  # ============================================================================

  @integration @unimplemented
  Scenario: An empty filter result shows a helpful empty state
    Given the current project has no project-only providers
    When I change the scope filter to "This project"
    Then the empty state says no providers are attached at that scope
    And the empty state links back to "All you can see"
