Feature: Resource Limit Enforcement (Teams)

  Creation-limit enforcement now applies ONLY to the structural/seat levers:
  projects, teams, members, and lite members. The experimentation resources
  (workflows, prompts, evaluators, scenarios, agents, experiments, online
  evaluations, datasets, dashboards, custom graphs, automations) are OSS
  (Apache 2.0) and uncapped — see oss-experimentation-uncapped.feature.

  Projects and members have dedicated specs (enforcement-projects.feature,
  enforcement-members.feature). This file covers the remaining team limit, which
  is enforced through the same LicenseEnforcementService path
  (license-enforcement.service + license-enforcement.repository).

  As a LangWatch deployment with a license
  I want team creation to respect the licensed team count
  So that organizations stay within their seat-based entitlements

  Background:
    Given an organization "org-123" exists
    And I am authenticated as an admin of "org-123"

  # ============================================================================
  # Teams: Backend Enforcement
  # ============================================================================

  @integration @unimplemented
  Scenario: Allows team creation when under limit
    Given the organization has a license with maxTeams 5
    And the organization has 3 teams
    When I create a team in the organization
    Then the team is created successfully

  @integration
  Scenario: Blocks team creation when at limit
    Given the organization has a license with maxTeams 3
    And the organization has 3 teams
    When I create a team in the organization
    Then the request fails with FORBIDDEN
    And the error message contains "maximum number of teams"

  @integration @unimplemented
  Scenario: Expired license enforces FREE tier team limit
    Given the organization has an expired license
    And the organization has 2 teams
    When I create a team in the organization
    Then the request fails with FORBIDDEN

  # ============================================================================
  # UI: Click-then-Modal Pattern (Teams)
  # ============================================================================

  @unit @unimplemented
  Scenario: Create Team button is always clickable
    Given the organization has a license with maxTeams 3
    And the organization has 3 teams (at limit)
    When I view the teams settings page
    Then the "Create team" button is enabled
    And the "Create team" button is not visually disabled

  @unit @unimplemented
  Scenario: Clicking Create Team at limit shows upgrade modal on submit
    Given the organization has a license with maxTeams 3
    And the organization has 3 teams (at limit)
    When I click the "Create team" button
    Then the team creation form is displayed
    When I fill the team name and click save
    Then an upgrade modal is displayed
    And the modal shows "Teams: 3 / 3"
    And the modal includes an upgrade call-to-action

  @unit @unimplemented
  Scenario: Clicking Create Team when allowed creates the team
    Given the organization has a license with maxTeams 5
    And the organization has 3 teams (under limit)
    When I click the "Create team" button
    And I fill the team name and click save
    Then the team is created successfully
    And no upgrade modal is shown
