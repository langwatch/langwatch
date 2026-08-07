@unit
Feature: Member Role Team Restrictions
  As a LangWatch organization admin
  I want team role options to be restricted based on organization role
  So that Lite Member users can only have Viewer team access and Members cannot be Viewers

  # The role-validation + auto-correction logic is bound below to
  # the unit tests in
  # `platform/app/src/utils/__tests__/memberRoleConstraints.unit.test.ts`
  # and `computeEffectiveTeamRoleUpdates.unit.test.ts`. Remaining
  # `@unimplemented` scenarios describe UI dropdown behaviour ("only
  # see Viewer in dropdown", "team role updates render in form",
  # default values when adding a team) that need a JSDOM render of
  # the AddMembers form — no fixture exists today. The "API rejects
  # non-Viewer team role assignments" scenario is covered in
  # `organization.member-roles.integration.test.ts` but that suite
  # is currently `describe.skip` due to an app-layer regression
  # (#3240).

  Background:
    Given I am on the Add Members form
    And there is at least one team available

  # ============================================================================
  # Label Display
  # ============================================================================

  @unimplemented
  Scenario: Organization role dropdown shows "Lite Member" instead of "External / Viewer"
    When I view the Org Role dropdown options
    Then I should see "Admin", "Member", and "Lite Member" as options
    And I should not see "External / Viewer" as an option

  # ============================================================================
  # Lite Member (EXTERNAL) Role Restrictions
  # ============================================================================

  @unimplemented
  Scenario: Lite Member org role restricts team role to Viewer only
    When I select "Lite Member" as the Org Role
    And I view the Team Role dropdown options
    Then I should only see "Viewer" as a team role option
    And I should not see "Admin" or "Member" as team role options
    And I should not see any custom roles

  @unimplemented
  Scenario: Lite Member does not show custom roles in team role dropdown
    Given the organization has custom roles defined
    When I select "Lite Member" as the Org Role
    And I view the Team Role dropdown options
    Then I should only see "Viewer" as a team role option

  # ============================================================================
  # Member Role Restrictions
  # ============================================================================

  @unimplemented
  Scenario: Member org role excludes Viewer from team role options
    When I select "Member" as the Org Role
    And I view the Team Role dropdown options
    Then I should see "Admin" and "Member" as team role options
    And I should not see "Viewer" as a team role option

  @unimplemented
  Scenario: Member org role includes custom roles
    Given the organization has custom roles defined
    When I select "Member" as the Org Role
    And I view the Team Role dropdown options
    Then I should see "Admin", "Member", and custom roles as options
    And I should not see "Viewer" as a team role option

  # ============================================================================
  # Admin Role (No Restrictions)
  # ============================================================================

  @unimplemented
  Scenario: Admin org role has all team role options available
    When I select "Admin" as the Org Role
    And I view the Team Role dropdown options
    Then I should see "Admin", "Member", and "Viewer" as team role options

  @unimplemented
  Scenario: Admin org role includes custom roles
    Given the organization has custom roles defined
    When I select "Admin" as the Org Role
    And I view the Team Role dropdown options
    Then I should see "Admin", "Member", "Viewer", and custom roles as options

  # ============================================================================
  # Dynamic Role Updates When Switching Org Role
  # ============================================================================

  @unimplemented
  Scenario: Switching from Member to Lite Member auto-corrects team role to Viewer
    Given I have selected "Member" as the Org Role
    And I have selected "Admin" as the Team Role
    When I change the Org Role to "Lite Member"
    Then the Team Role should automatically change to "Viewer"

  @unimplemented
  Scenario: Switching from Lite Member to Member auto-corrects team role to Member
    Given I have selected "Lite Member" as the Org Role
    And the Team Role is "Viewer"
    When I change the Org Role to "Member"
    Then the Team Role should automatically change to "Member"

  @unimplemented
  Scenario: Switching from Admin to Lite Member auto-corrects team role to Viewer
    Given I have selected "Admin" as the Org Role
    And I have selected "Member" as the Team Role
    When I change the Org Role to "Lite Member"
    Then the Team Role should automatically change to "Viewer"

  @unimplemented
  Scenario: Switching from Admin to Member with Viewer team role auto-corrects to Member
    Given I have selected "Admin" as the Org Role
    And I have selected "Viewer" as the Team Role
    When I change the Org Role to "Member"
    Then the Team Role should automatically change to "Member"

  @unimplemented
  Scenario: Switching from Member to Admin keeps existing team role
    Given I have selected "Member" as the Org Role
    And I have selected "Admin" as the Team Role
    When I change the Org Role to "Admin"
    Then the Team Role should remain "Admin"

  # ============================================================================
  # Default Team Role Based on Org Role
  # ============================================================================

  @unimplemented
  Scenario: Adding a new team assignment defaults to Viewer for Lite Member
    Given I have selected "Lite Member" as the Org Role
    When I click "Add team" to add a team assignment
    Then the new team assignment should have "Viewer" as the default team role

  @unimplemented
  Scenario: Adding a new team assignment defaults to Member for Member org role
    Given I have selected "Member" as the Org Role
    When I click "Add team" to add a team assignment
    Then the new team assignment should have "Member" as the default team role

  @unimplemented
  Scenario: Adding a new team assignment defaults to Member for Admin org role
    Given I have selected "Admin" as the Org Role
    When I click "Add team" to add a team assignment
    Then the new team assignment should have "Member" as the default team role

  # ============================================================================
  # Multiple Team Assignments
  # ============================================================================

  @unimplemented
  Scenario: All team assignments respect Lite Member restrictions
    Given I have selected "Lite Member" as the Org Role
    And I have added multiple team assignments
    When I view any Team Role dropdown
    Then each dropdown should only show "Viewer" as an option

  @unimplemented
  Scenario: Switching org role updates all team assignments
    Given I have selected "Member" as the Org Role
    And I have multiple team assignments with "Admin" team role
    When I change the Org Role to "Lite Member"
    Then all team assignments should have "Viewer" as the team role

  # ============================================================================
  # Member Edit Page Persistence and API Validation
  # ============================================================================

  @integration @unimplemented
  Scenario: Editing a member does not persist organization role until save
    Given I am on the member details page
    And the organization role is "Member"
    When I change the organization role to "Lite Member"
    Then the change should remain pending
    And the persisted organization role should stay "Member" until I click "Save"

  # The correction reaches the teams the organization shares, not the workspace
  # each member gets to themselves. That workspace has a single admin, its
  # owner, so including it would ask the organization to remove a team's last
  # admin and the whole save would be refused. See
  # specs/ai-gateway/governance/personal-workspace-integrity.feature for the
  # scenarios that hold that line.

  @integration @unimplemented
  Scenario: Saving a Lite Member update enforces Viewer team role in every shared team
    Given I am editing a member with organization role "Member"
    And the member has team roles "Admin" and "Member"
    When I change the organization role to "Lite Member"
    And I click "Save"
    Then the member should be saved as "Lite Member"
    And all of the member shared team roles should be "Viewer"
    And their own personal workspace should be untouched

  @integration @unimplemented
  Scenario: API rejects non-Viewer team role assignments for Lite Members
    Given a member has organization role "Lite Member"
    When I try to set a team role to "Admin", "Member", or a custom role
    Then the update should fail with an error
    And the member team role should remain "Viewer"

  @integration @unimplemented
  Scenario: Lite Member label is shown correctly on member details
    Given I am a Lite Member viewing my own member details
    When I look at the organization role field
    Then I should see "Lite Member"
    And I should not see "EXTERNAL"

  @integration @unimplemented
  Scenario: Only organization administrators can save member role changes
    Given I am on the member details page
    And I do not have organization administrator permissions
    When I view the member details page
    Then the organization role field should be read-only
    And the team role fields should be read-only
    And I should not see Save or Cancel buttons
    And I should see a Back button

  # ============================================================================
  # A seat decision and a team's last admin
  # ============================================================================

  # The correction to Viewer can take away the only team-scoped admin a shared
  # team has, and the last-admin guard used to refuse that, which took the whole
  # seat change down with it: the organization role never changed either, and no
  # amount of editing the member's access in the dialog helped, because the seat
  # change is applied before it and always saw the roles as they still were.
  #
  # The guard protects a team from having nobody who can administer it. An
  # ORGANIZATION-scoped ADMIN binding grants team permissions in every shared
  # team, so an organization admin still administers a team whose last
  # team-scoped admin is gone, and the state the guard exists to prevent is not
  # the state this produces. So a seat decision, which is the organization's to
  # make, goes through, and the teams it changed are named back to the admin who
  # made it. Editing a single team's own members is a team-local decision and
  # keeps the guard.

  @integration
  Scenario: Moving the only admin of a shared team to a Lite Member seat goes through
    Given a member is the only admin of a shared team
    When an organization admin moves them to a Lite Member seat
    Then the seat change is saved
    And their role on that team becomes Viewer

  @integration
  Scenario: The teams left without a team admin are named back to the admin
    Given a member is the only admin of two shared teams
    When an organization admin moves them to a Lite Member seat
    Then the save reports both teams as left without a team admin
    And it does not report a team that still has another admin

  @integration
  Scenario: A seat change that names team roles outright still keeps the guard
    Given a member is the only admin of a shared team
    When a caller asks for that team role to be Viewer as part of the seat change
    Then the change is refused
    And the refusal names the team

  @integration
  Scenario: Saving the team form cannot take its last admin away
    Given a member is the only admin of a shared team
    When the team is saved with that member demoted or dropped from the list
    Then the save is refused
    And the refusal names the team
    And the team keeps its admin

  @integration
  Scenario: The team form hands the admin role to somebody else in one save
    Given a member is the only admin of a shared team
    When the team is saved promoting somebody else to admin and demoting them
    Then the save goes through

  @integration
  Scenario: A team already without a team admin stays editable
    Given a seat correction left a team with no team admin
    When the team is saved with a membership change
    Then the save goes through

  @integration
  Scenario: Editing one team's members still refuses to remove its last admin
    Given a member is the only admin of a shared team
    When an organization admin changes that team role from the team's own members
    Then the change is refused
    And the refusal names the team
