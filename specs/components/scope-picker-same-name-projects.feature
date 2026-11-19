Feature: Scope pickers tell same-name projects apart
  As someone picking a project in a scope picker
  I want two projects that share a name to read differently
  So that I pick the one I mean, not the one listed first

  Every personal workspace is called "Personal Workspace", and two teams can
  each hold a project with the same name. `ScopeChipPicker` and `ScopeFilter`
  listed projects by name alone, so those rows looked identical (issue #9734).
  A project whose name another listed project shares now carries the green
  scope name badge on the right: the caller's hint when it gave one (a
  personal workspace's owner), otherwise the project's team. A unique name
  carries nothing. The badge only uses names the reader's own scope list
  already holds; nothing new is sent from the server.

  Background:
    Given the reader can see the teams "Platform" and "Research"
    And each team has a project called "Eval Harness"
    And the reader can see a project called "Web App" in "Platform"

  @integration @regression
  Scenario: Same-name projects in different teams name their team in a badge
    When I open the project list of a scope picker
    Then the "Eval Harness" row of "Platform" shows "Platform" in a green badge on the right
    And the "Eval Harness" row of "Research" shows "Research" in a green badge on the right

  @integration @regression
  Scenario: A project with a unique name shows no badge
    When I open the project list of a scope picker
    Then the "Web App" row shows no badge

  @integration @regression
  Scenario: Names that differ only by case or spacing count as the same name
    Given a third project is called "eval harness " in "Research"
    When I open the project list of a scope picker
    Then every one of the three rows shows a badge

  @integration @regression
  Scenario: A personal workspace names its owner, and the reader's own says "(you)"
    Given the reader is "Alex Rivera" and an organization admin
    And the reader can see their own personal workspace and the one of "Sam Lee"
    When I open the project list of a scope picker
    Then one "Personal Workspace" row shows "Alex Rivera (you)" in a green badge
    And the other "Personal Workspace" row shows "Sam Lee" in a green badge

  @integration @regression
  Scenario: A reader who sees only their own personal workspace sees no owner badge
    Given the reader is not an organization admin
    And the only personal workspace they can see is their own
    When I open the project list of a scope picker
    Then the "Personal Workspace" row shows no badge
    And no other person's name appears in the list

  @integration @regression
  Scenario: A personal team that no longer carries its owner in its name shows the whole team name
    Given a personal team is called "Lab bench" rather than "<owner>'s Workspace"
    And its personal workspace shares its name with another listed project
    Then that row's badge reads "Lab bench"

  @integration @regression
  Scenario: A repeated name with nothing to tell it apart shows no badge
    Given two projects share a name
    But neither has a hint and neither has a team the picker was given
    When I open the project list of a scope picker
    Then neither row shows a badge

  @integration @regression
  Scenario: Searching finds a project by its team or owner name
    When I search the project list for "research"
    Then the "Eval Harness" row of "Research" is listed
    And the "Eval Harness" row of "Platform" is not
    When I search the project list for "sam"
    Then the personal workspace of "Sam Lee" is listed

  @integration @regression
  Scenario: A search with a space in it keeps the dropdown open
    Given the scope chip picker has a search field
    When I type "alex rivera (you)" into it
    Then the dropdown stays open and lists only the personal workspace of "Alex Rivera"
    And the space did not pick the highlighted option

  @integration @regression
  Scenario: Enter after a search picks the first same-name match, not its namesake
    When I search More Scopes for "eval harness" and press Enter
    Then the filter narrows to the "Eval Harness" project of "Platform"
    And the "Eval Harness" project of "Research" is not picked

  @integration @regression
  Scenario: A screen reader hears the name and then the badge
    When I open the project list of a scope picker
    Then a screen reader names the row "Eval Harness, Research"

  @integration @regression
  Scenario: A long badge truncates and shows its whole text on hover
    Given a team with a name longer than the row has room for owns a same-name project
    When I open the project list of a scope picker
    Then the badge truncates with an ellipsis
    And hovering the badge shows the whole team name

  @integration @regression
  Scenario: Model provider pickers list project names without a team suffix
    When I open the scope picker of a model provider
    Then the projects read "Eval Harness" and "Web App", not "Eval Harness · Platform"
    And the two "Eval Harness" rows carry their team names in green badges
