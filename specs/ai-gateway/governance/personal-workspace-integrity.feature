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

  # ============================================================================
  # A seat decision is never blocked by a personal workspace
  # ============================================================================
  #
  # A personal workspace is not one of the organization's teams. It is
  # provisioned for every member rather than chosen by anyone, and its owner is
  # its only admin. So the correction that drops a downgraded member to Viewer
  # covers the shared teams they work in and leaves the workspace that is only
  # theirs alone: sweeping it in would ask the organization to remove the last
  # admin of a team, which is refused, and the refusal used to take the seat
  # change down with it.
  #
  # Leaving the workspace alone costs nothing, because a person's organization
  # role already decides what they can do inside it. A view-only member reads
  # their workspace and writes nothing, holding the same admin role on it they
  # always did, which is why nothing has to be rebuilt when they get their full
  # access back.

  @integration
  Scenario: Moving a member who has a personal workspace to Lite Member succeeds
    Given another member of the organization who has a personal workspace
    And that member is an admin of a shared team
    When I change that member's organization role to Lite Member
    Then the member's organization role is Lite Member
    And their role on the shared team is Viewer
    And they are still the admin of their own personal workspace

  @integration
  Scenario: A Lite Member reads their own personal workspace but cannot write to it
    Given a Lite Member of the organization who has a personal workspace
    Then they can read their personal workspace
    But they cannot write to it

  @integration
  Scenario: Giving a Lite Member their full access back restores writing in their own workspace
    Given a Lite Member of the organization who has a personal workspace
    When I change that member's organization role to Member
    Then they can write to their personal workspace again

  # Read-only and unexplained is indistinguishable from broken: the page renders
  # in full and only the save fails, so the workspace has to say why itself.

  @integration
  Scenario: A Lite Member is told why their own workspace takes nothing
    Given a Lite Member of the organization who has a personal workspace
    When they open their workspace
    Then they are told their organization gives them view-only access
    And a member with full access is told nothing

  @integration
  Scenario: A personal workspace is not listed among the access an admin manages
    Given another member of the organization who has a personal workspace
    When I list the access that member holds in the organization
    Then their personal workspace is not among it

  # An admin who still finds a way to aim a role change at a personal workspace
  # gets told which workspace, because "a personal workspace" leaves them looking
  # for the one they hit among as many as the organization has members.

  @integration
  Scenario: Refusing a change to a personal workspace says whose workspace it is
    Given the organization has 1 personal team
    When I change the owner's role on their personal workspace
    Then the refusal names the workspace as that member's own

  # ============================================================================
  # A workspace goes when the access it came with goes
  # ============================================================================
  #
  # Refusing to archive a personal workspace is only defensible because there is
  # a moment when it does go: when the member stops being a member. That was the
  # promise the refusal made and the one thing nothing did, so a workspace
  # outlived its owner's membership, kept its one slot per (organization, owner),
  # and no admin had any way to be rid of it.
  #
  # Archived rather than deleted, like every other project. Which means the slot
  # is still taken, so provisioning has to recognise its own archived workspace
  # and revive it, or inviting the same person back would fail on the uniqueness
  # of a slot nothing can see.

  @integration
  Scenario: Removing a member takes their personal workspace with them
    Given another member of the organization who has a personal workspace
    When I remove that member from the organization
    Then their personal workspace is archived
    And its project is archived with it

  @integration
  Scenario: Inviting a removed member back gives them their workspace again
    Given a member whose personal workspace was archived when they were removed
    When that member joins the organization again
    Then they get the same workspace back rather than a new one
    And they can reach it
