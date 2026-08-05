Feature: A personal workspace stays one person's
  A personal workspace is one team, one project, one owner. Every mutation
  that could take that shape apart is refused, and the owner holds the
  permission each of those mutations checks, so the refusal is the only thing
  standing between an administrator and a broken workspace.

  Breaking the shape is not cosmetic. A personal team without its project is
  not a workspace the provisioning lookup can find, while the one slot allowed
  per (organization, owner) stays taken, so the owner is left with no personal
  workspace and no way to get one back.

  Pairs with:
  - specs/ai-gateway/governance/personal-workspace-not-ambient-context.feature
  - specs/ai-gateway/governance/personal-workspace-features.feature

  Background:
    Given I am an admin of an organization

  # ============================================================================
  # The project cannot leave, arrive, multiply or disappear
  # ============================================================================
  #
  # A project lives in a personal workspace only when its own personal flag and
  # its team's agree. Moving a project across that boundary would leave the two
  # disagreeing, so the move is refused rather than reconciled after the fact.

  @integration
  Scenario: Moving a personal project into a shared team is refused
    Given the organization has 1 personal project
    When I move the personal project into team "team-456"
    Then the request fails with FORBIDDEN
    And the owner still has a personal workspace

  @integration
  Scenario: Moving a real project into a personal workspace is refused
    Given the organization has 1 project in team "team-456"
    And the organization has 1 personal team
    When I move that project into the personal team
    Then the request fails with FORBIDDEN

  @integration
  Scenario: Creating a project in a personal workspace is refused
    Given the organization has 1 personal team
    When I create a project in the personal team
    Then the request fails with FORBIDDEN
    And the personal team still holds exactly its own project

  @integration
  Scenario: Archiving a personal project is refused
    Given the organization has 1 personal project
    When I archive the personal project
    Then the request fails with FORBIDDEN
    And the owner still has a personal workspace

  # ============================================================================
  # The membership cannot grow, shrink or change hands
  # ============================================================================
  #
  # A personal workspace stays one person's however the organization is
  # administered, and whether access is handed to a person or to a group.

  @integration
  Scenario: Adding a member to a personal team is refused
    Given the organization has 1 personal team
    When I add another member to the personal team
    Then the request fails with FORBIDDEN
    And the personal team still has exactly its owner

  @integration
  Scenario: Giving someone else access to a personal workspace is refused
    Given the organization has 1 personal team
    And another member of the organization
    When I give that member access to the personal workspace
    Then the request fails with FORBIDDEN
    And the personal workspace is still only its owner's

  @integration
  Scenario: Giving a group access to a personal workspace is refused
    Given the organization has 1 personal team
    And a group in the organization
    When I give that group access to the personal workspace
    Then the request fails with FORBIDDEN
    And the personal workspace is still only its owner's

  @integration
  Scenario: Taking the owner's access to their own workspace away is refused
    Given the organization has 1 personal team
    When I remove the owner from their personal workspace
    Then the request fails with FORBIDDEN
    And the owner still has a personal workspace

  @integration
  Scenario: Changing the owner's role on their own workspace is refused
    Given the organization has 1 personal team
    When I change the owner's role on their personal workspace
    Then the request fails with FORBIDDEN
    And the personal workspace is still only its owner's

  # Archiving a personal team cannot be undone by the owner: the uniqueness of
  # a personal team per (organization, owner) covers archived rows too, while
  # the workspace lookup skips them. The archived team keeps the slot, so
  # provisioning can neither find the workspace nor create a replacement.

  @integration
  Scenario: Archiving a personal team is refused
    Given the organization has 1 personal team
    When I archive the personal team
    Then the request fails with FORBIDDEN
    And the owner still has a personal workspace

  # What the owner can still do with their own workspace.

  @integration
  Scenario: Renaming a personal team is still allowed
    Given the organization has 1 personal team
    When I rename the personal team
    Then the team is renamed successfully
