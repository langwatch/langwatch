@wip @integration
Feature: Project Limit Enforcement with License

  # All scenarios in this file describe project-creation enforcement
  # against license limits. The repository.getProjectCount is exercised
  # indirectly by license-enforcement.service.unit.test.ts (the it.each
  # over LimitType includes 'projects'). End-to-end "I create a project,
  # FORBIDDEN" requires a tRPC project-create-router integration test
  # against a license-bearing organization, which does not exist yet —
  # all aspirational pending that harness.

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

  Scenario: Blocks project creation when over limit
    Given the organization has a license with maxProjects 2
    And the organization has 3 projects
    When I create a project named "New Project"
    Then the request fails with FORBIDDEN

  # ============================================================================
  # Invalid/Expired License (FREE Tier)
  # ============================================================================

  @unimplemented
  Scenario: Expired license enforces FREE tier project limit
    Given the organization has an expired license
    And the organization has 2 projects
    When I create a project named "New Project"
    Then the request fails with FORBIDDEN

  @unimplemented
  Scenario: Invalid license blocks at FREE tier limit of 2
    Given the organization has an invalid license signature
    And the organization has 2 projects
    When I create a project named "New Project"
    Then the request fails with FORBIDDEN

  @unimplemented
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

  # ============================================================================
  # Personal Workspaces
  # ============================================================================
  #
  # Everyone on the free plan should be able to track their own coding-agent
  # usage, which needs a personal workspace. A personal workspace must not
  # spend any of the projects the customer gets for real work.
  #
  # The same count backs enforcement, the usage page, and the license status
  # panel, so a personal project is invisible to all three or to none of them.

  Scenario: Personal projects do not count toward the project limit
    Given the organization has a license with maxProjects 2
    And the organization has 2 personal projects
    When I create a project named "New Project"
    Then the project is created successfully

  Scenario: Real projects still reach the limit alongside personal projects
    Given the organization has a license with maxProjects 2
    And the organization has 2 projects
    And the organization has 1 personal project
    When I create a project named "New Project"
    Then the request fails with FORBIDDEN

  Scenario: A free organization keeps its full project allowance after provisioning a personal workspace
    Given the organization is on the free plan allowing 2 projects
    And every member has a personal workspace
    When I create a project for real work
    Then the project is created successfully

  Scenario: The reported project usage excludes personal projects
    Given the organization has 2 projects
    And the organization has 1 personal project
    When I view the organization usage
    Then the reported project count is 2

  # ----------------------------------------------------------------------------
  # The exemption is anchored to the workspace, not to a flag
  # ----------------------------------------------------------------------------
  #
  # A project is exempt because it lives in someone's personal workspace, and
  # a project only lives there when both its own personal flag and its team's
  # agree. Moving a project across that boundary would settle the question by
  # flag alone, so the move is refused rather than counted after the fact.
  #
  # It also breaks the workspace itself. A personal team without its project
  # is not a workspace the service can find, and the (organization, owner)
  # slot stays taken, so provisioning can neither find nor recreate it.

  Scenario: Moving a personal project into a shared team is refused
    Given the organization has 1 personal project
    When I move the personal project into team "team-456"
    Then the request fails with FORBIDDEN
    And the reported project count is unchanged
    And the owner still has a personal workspace

  Scenario: Moving a real project into a personal workspace is refused
    Given the organization has 1 project in team "team-456"
    And the organization has 1 personal team
    When I move that project into the personal team
    Then the request fails with FORBIDDEN
    And the reported project count is unchanged

  # A personal workspace is its project. Archiving it hides the workspace from
  # the lookup that provisions it while the team keeps the one slot allowed per
  # (organization, owner), so the owner is left with no personal workspace and
  # no way to get one back.

  Scenario: Creating a project in a personal workspace is refused
    Given the organization has 1 personal team
    When I create a project in the personal team
    Then the request fails with FORBIDDEN
    And the personal workspace still holds exactly one project

  Scenario: Archiving a personal project is refused
    Given the organization has 1 personal project
    When I archive the personal project
    Then the request fails with FORBIDDEN
    And the owner still has a personal workspace

  Scenario: A project counts unless its own flag and its team both call it personal
    Given the organization has 2 projects
    And the organization has 1 project marked personal inside a shared team
    And the organization has 1 project not marked personal inside a personal team
    When I view the organization usage
    Then the reported project count is 4
