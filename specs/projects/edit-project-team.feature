@integration
Feature: Edit project name and team
  As an organization admin
  I want to edit a project's name and move it to a different team
  So that I can reorganize my projects across workspaces

  Background:
    Given I am logged in as an authenticated user
    And I have an organization with teams "Engineering" and "Analytics"
    And team "Engineering" has a project "My Chatbot"

  # ── REST API ────────────────────────────────────────────────────────────────

  @unit
  Scenario: PATCH /api/projects/:id updates project name
    Given I have a valid organization API key
    When I send PATCH /api/projects/:id with body:
      | field | value         |
      | name  | Renamed Bot   |
    Then the response status is 200
    And the response body includes name "Renamed Bot"

  @unit
  Scenario: PATCH /api/projects/:id moves project to different team
    Given I have a valid organization API key
    And team "Analytics" exists in the same organization
    When I send PATCH /api/projects/:id with body:
      | field  | value              |
      | teamId | Analytics team id  |
    Then the response status is 200
    And the response body includes the new teamId

  @unit
  Scenario: PATCH /api/projects/:id updates name and team together
    Given I have a valid organization API key
    When I send PATCH /api/projects/:id with body:
      | field  | value              |
      | name   | Moved Bot          |
      | teamId | Analytics team id  |
    Then the response status is 200
    And the response body includes name "Moved Bot"
    And the response body includes the new teamId

  @unit
  Scenario: PATCH rejects teamId from different organization
    Given I have a valid organization API key
    And team "External" belongs to a different organization
    When I send PATCH /api/projects/:id with teamId of "External"
    Then the response status is 400
    And the error message indicates the team is not in the same organization

  @unit
  Scenario: PATCH rejects teamId of archived team
    Given I have a valid organization API key
    And team "Analytics" is archived
    When I send PATCH /api/projects/:id with teamId of "Analytics"
    Then the response status is 400
    And the error message indicates the destination team is archived

  @unit
  Scenario: PATCH rejects non-existent teamId
    Given I have a valid organization API key
    When I send PATCH /api/projects/:id with teamId "nonexistent"
    Then the response status is 400

  @unit
  Scenario: PATCH with teamId and name is atomic
    Given I have a valid organization API key
    And team "Analytics" is archived
    When I send PATCH /api/projects/:id with name "New Name" and teamId of "Analytics"
    Then the response status is 400
    And the project name remains unchanged

  # ── tRPC ────────────────────────────────────────────────────────────────────

  @unit
  Scenario: tRPC project.update accepts optional teamId
    Given I am authenticated with project:update permission
    And team "Analytics" exists in the same organization
    When I call project.update with teamId of "Analytics"
    Then the project teamId is updated to "Analytics"

  @unit
  Scenario: tRPC project.update rejects cross-org team
    Given I am authenticated with project:update permission
    And team "External" belongs to a different organization
    When I call project.update with teamId of "External"
    Then the mutation fails with BAD_REQUEST

  # ── Service layer ───────────────────────────────────────────────────────────

  @unit
  Scenario: ProjectService.update changes teamId with same-org validation
    Given a project in team "Engineering"
    And team "Analytics" in the same organization
    When I call ProjectService.update with teamId of "Analytics"
    Then the project's teamId is updated
    And the project remains in the same organization

  @unit
  Scenario: ProjectService.update rejects archived destination team
    Given a project in team "Engineering"
    And team "Analytics" is archived
    When I call ProjectService.update with teamId of "Analytics"
    Then the service throws an error

  @unit
  Scenario: ProjectService.update with no teamId leaves team unchanged
    Given a project in team "Engineering"
    When I call ProjectService.update without teamId
    Then the project's teamId remains "Engineering"

  # ── RBAC inheritance ─────────────────────────────────────────────────────────

  @unit
  Scenario: Moving project changes team-scoped access inheritance
    Given user Alice has MEMBER role on team "Engineering" only
    And project "My Chatbot" is in team "Engineering"
    When an admin moves "My Chatbot" to team "Analytics"
    Then Alice no longer has inherited access to "My Chatbot"
    And users with team "Analytics" bindings now inherit access to "My Chatbot"
    And project-scoped bindings on "My Chatbot" remain unchanged

  # ── UI ──────────────────────────────────────────────────────────────────────

  @integration
  Scenario: Edit button appears on project row
    Given I am on the Settings Teams & Projects page
    And I have team:manage permission
    When I look at a project row
    Then I see an Edit button with a pencil icon next to the access count

  @integration
  Scenario: Edit button opens project edit drawer
    Given I am on the Settings Teams & Projects page
    When I click the Edit button on project "My Chatbot"
    Then the EditProject drawer opens
    And it shows the current project name "My Chatbot"
    And it shows a team selector with the current team "Engineering" selected

  @integration
  Scenario: User updates project name via drawer
    Given the EditProject drawer is open for "My Chatbot"
    When I change the name to "Renamed Bot"
    And I click Save
    Then the drawer closes
    And I see a success toast
    And the project list refreshes showing "Renamed Bot"

  @integration
  Scenario: User moves project to different team via drawer
    Given the EditProject drawer is open for "My Chatbot"
    When I select team "Analytics" from the team dropdown
    And I click Save
    Then the drawer closes
    And I see a success toast
    And the project appears under team "Analytics"

  @integration
  Scenario: Team selector only shows non-archived teams in same org
    Given the EditProject drawer is open
    Then the team dropdown lists "Engineering" and "Analytics"
    And the team dropdown does not list archived teams

  @integration
  Scenario: Edit button hidden for users without manage permission
    Given I am on the Settings Teams & Projects page
    And I do not have team:manage permission
    When I look at a project row
    Then I do not see an Edit button
