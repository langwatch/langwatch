Feature: Model providers scope filter
  As a user managing model providers across an organization
  I want to filter the providers list by the scope they're attached to
  So that I can focus on one branch of the org tree without losing the parent / child rows that resolve through it

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
  # Scope filters — inclusive cascade
  # ============================================================================
  # The filter is inclusive: picking a scope keeps everything on the same
  # branch of the org tree (parents up, children down), and hides the other
  # branches. If a user needs to find one specific row they can still ctrl+F.

  @integration
  Scenario: Picking the organization keeps every row in that org's tree
    When I change the scope filter to the organization
    Then the list keeps every provider in the org, including team- and project-scoped rows

  @integration
  Scenario: Picking a team keeps org rows, the team itself, and its projects
    When I change the scope filter to a team
    Then the list keeps providers attached to the organization (parent)
    And the list keeps providers attached to the picked team
    And the list keeps providers attached to projects whose parent team is the picked team
    And providers on sibling teams or projects in other teams are hidden

  @integration
  Scenario: Picking a project keeps org rows, the project's parent team, and the project itself
    When I change the scope filter to a project
    Then the list keeps providers attached to the organization (grand-parent)
    And the list keeps providers attached to the picked project's parent team
    And the list keeps providers attached to the picked project
    And providers on sibling projects or unrelated teams are hidden

  # ============================================================================
  # Empty states
  # ============================================================================

  @integration @unimplemented
  Scenario: An empty filter result shows a helpful empty state
    Given the current project has no project-only providers
    When I change the scope filter to the current project
    Then the empty state says no providers are attached at that scope
    And the empty state links back to "All you can see"
