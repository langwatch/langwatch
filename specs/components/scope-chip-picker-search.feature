Feature: Scope picker search and team grouping
  As a user scoping a resource in an organization with many teams and projects
  I want the scope dropdown to group projects under their team and to be searchable
  So that I can find the right scope without reading one long flat list

  `ScopeChipPicker` is the shared scope selector (see
  dev/docs/best_practices/scope-selector-and-badges.md). Both of its
  dropdown variants gain a search field when the option list is long,
  and the multi-select dropdown groups project options under their team
  name the way the single-select variant already does.

  @integration
  Scenario: Projects group under their team name
    Given my organization has two teams with projects in each
    When I open the scope dropdown
    Then each project lists under a group header carrying its team name
    And a project whose team is not listed falls under a plain "Projects" group

  @integration
  Scenario: A long scope list gets a search field
    Given the picker offers more than eight scopes
    When I open the scope dropdown
    Then a search field sits at the top of the list
    And typing narrows the options to those whose name or team matches

  @integration
  Scenario: A short scope list has no search field
    Given the picker offers eight scopes or fewer
    When I open the scope dropdown
    Then the options list has no search field

  @integration
  Scenario: Searching does not drop scopes already selected
    Given two scopes are selected
    When I search for a third scope and select it
    Then all three scopes stay selected
