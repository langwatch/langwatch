@wip @integration
Feature: Project Limit Enforcement with License
  As a LangWatch self-hosted deployment with a license
  I want the project creation limit to be enforced
  So that organizations respect their licensed project count

  Background:
    Given an organization "org-123" exists
    And I am authenticated as an admin of "org-123"
    And a team "team-456" exists in the organization

  # ============================================================================
  # License-Based Project Limits
  # ============================================================================

  Scenario: Allows project creation when under limit
    Given the organization has a license with maxProjects 5
    And the organization has 3 projects
    When I create a project named "New Project"
    Then the project is created successfully

  Scenario: Blocks project creation when at limit
    Given the organization has a license with maxProjects 3
    And the organization has 3 projects
    When I create a project named "New Project"
    Then the request fails with FORBIDDEN
    And the error message contains "maximum number of projects"

  Scenario: Blocks project creation when over limit
    Given the organization has a license with maxProjects 2
    And the organization has 3 projects
    When I create a project named "New Project"
    Then the request fails with FORBIDDEN

  # ============================================================================
  # Invalid/Expired License (FREE Tier)
  # ============================================================================

  Scenario: Expired license enforces FREE tier project limit
    Given the organization has an expired license
    And the organization has 2 projects
    When I create a project named "New Project"
    Then the request fails with FORBIDDEN

  Scenario: Invalid license blocks at FREE tier limit of 2
    Given the organization has an invalid license signature
    And the organization has 2 projects
    When I create a project named "New Project"
    Then the request fails with FORBIDDEN

  Scenario: Invalid license allows creation under FREE tier limit
    Given the organization has an invalid license signature
    And the organization has 1 project
    When I create a project named "New Project"
    Then the project is created successfully

  # ============================================================================
  # Edge Cases
  # ============================================================================

  Scenario: Counts only non-archived projects toward limit
    Given the organization has a license with maxProjects 3
    And the organization has 2 active projects
    And the organization has 2 archived projects
    When I create a project named "New Project"
    Then the project is created successfully

  Scenario: Counts projects across all teams
    Given the organization has a license with maxProjects 3
    And team "team-456" has 2 projects
    And team "team-789" has 1 project
    When I create a project named "New Project"
    Then the request fails with FORBIDDEN
