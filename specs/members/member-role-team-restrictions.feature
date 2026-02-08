@unit
Feature: Member Role Team Restrictions
  As a LangWatch organization admin
  I want team role options to be restricted based on organization role
  So that Lite Member users can only have Viewer team access and Members cannot be Viewers

  Background:
    Given I am on the Add Members form
    And there is at least one team available

  # ============================================================================
  # Label Display
  # ============================================================================

  Scenario: Organization role dropdown shows "Lite Member" instead of "External / Viewer"
    When I view the Org Role dropdown options
    Then I should see "Admin", "Member", and "Lite Member" as options
    And I should not see "External / Viewer" as an option

  # ============================================================================
  # Lite Member (EXTERNAL) Role Restrictions
  # ============================================================================

  Scenario: Lite Member org role restricts team role to Viewer only
    When I select "Lite Member" as the Org Role
    And I view the Team Role dropdown options
    Then I should only see "Viewer" as a team role option
    And I should not see "Admin" or "Member" as team role options
    And I should not see any custom roles

  Scenario: Lite Member does not show custom roles in team role dropdown
    Given the organization has custom roles defined
    When I select "Lite Member" as the Org Role
    And I view the Team Role dropdown options
    Then I should only see "Viewer" as a team role option

  # ============================================================================
  # Member Role Restrictions
  # ============================================================================

  Scenario: Member org role excludes Viewer from team role options
    When I select "Member" as the Org Role
    And I view the Team Role dropdown options
    Then I should see "Admin" and "Member" as team role options
    And I should not see "Viewer" as a team role option

  Scenario: Member org role includes custom roles
    Given the organization has custom roles defined
    When I select "Member" as the Org Role
    And I view the Team Role dropdown options
    Then I should see "Admin", "Member", and custom roles as options
    And I should not see "Viewer" as a team role option

  # ============================================================================
  # Admin Role (No Restrictions)
  # ============================================================================

  Scenario: Admin org role has all team role options available
    When I select "Admin" as the Org Role
    And I view the Team Role dropdown options
    Then I should see "Admin", "Member", and "Viewer" as team role options

  Scenario: Admin org role includes custom roles
    Given the organization has custom roles defined
    When I select "Admin" as the Org Role
    And I view the Team Role dropdown options
    Then I should see "Admin", "Member", "Viewer", and custom roles as options

  # ============================================================================
  # Dynamic Role Updates When Switching Org Role
  # ============================================================================

  Scenario: Switching from Member to Lite Member auto-corrects team role to Viewer
    Given I have selected "Member" as the Org Role
    And I have selected "Admin" as the Team Role
    When I change the Org Role to "Lite Member"
    Then the Team Role should automatically change to "Viewer"

  Scenario: Switching from Lite Member to Member auto-corrects team role to Member
    Given I have selected "Lite Member" as the Org Role
    And the Team Role is "Viewer"
    When I change the Org Role to "Member"
    Then the Team Role should automatically change to "Member"

  Scenario: Switching from Admin to Lite Member auto-corrects team role to Viewer
    Given I have selected "Admin" as the Org Role
    And I have selected "Member" as the Team Role
    When I change the Org Role to "Lite Member"
    Then the Team Role should automatically change to "Viewer"

  Scenario: Switching from Admin to Member with Viewer team role auto-corrects to Member
    Given I have selected "Admin" as the Org Role
    And I have selected "Viewer" as the Team Role
    When I change the Org Role to "Member"
    Then the Team Role should automatically change to "Member"

  Scenario: Switching from Member to Admin keeps existing team role
    Given I have selected "Member" as the Org Role
    And I have selected "Admin" as the Team Role
    When I change the Org Role to "Admin"
    Then the Team Role should remain "Admin"

  # ============================================================================
  # Default Team Role Based on Org Role
  # ============================================================================

  Scenario: Adding a new team assignment defaults to Viewer for Lite Member
    Given I have selected "Lite Member" as the Org Role
    When I click "Add team" to add a team assignment
    Then the new team assignment should have "Viewer" as the default team role

  Scenario: Adding a new team assignment defaults to Member for Member org role
    Given I have selected "Member" as the Org Role
    When I click "Add team" to add a team assignment
    Then the new team assignment should have "Member" as the default team role

  Scenario: Adding a new team assignment defaults to Member for Admin org role
    Given I have selected "Admin" as the Org Role
    When I click "Add team" to add a team assignment
    Then the new team assignment should have "Member" as the default team role

  # ============================================================================
  # Multiple Team Assignments
  # ============================================================================

  Scenario: All team assignments respect Lite Member restrictions
    Given I have selected "Lite Member" as the Org Role
    And I have added multiple team assignments
    When I view any Team Role dropdown
    Then each dropdown should only show "Viewer" as an option

  Scenario: Switching org role updates all team assignments
    Given I have selected "Member" as the Org Role
    And I have multiple team assignments with "Admin" team role
    When I change the Org Role to "Lite Member"
    Then all team assignments should have "Viewer" as the team role

  # ============================================================================
  # Member Edit Page Persistence and API Validation
  # ============================================================================

  @integration
  Scenario: Editing a member does not persist organization role until save
    Given I am on the member details page
    And the organization role is "Member"
    When I change the organization role to "Lite Member"
    Then the change should remain pending
    And the persisted organization role should stay "Member" until I click "Save"

  @integration
  Scenario: Saving a Lite Member update enforces Viewer team role in every team
    Given I am editing a member with organization role "Member"
    And the member has team roles "Admin" and "Member"
    When I change the organization role to "Lite Member"
    And I click "Save"
    Then the member should be saved as "Lite Member"
    And all of the member team roles should be "Viewer"

  @integration
  Scenario: API rejects non-Viewer team role assignments for Lite Members
    Given a member has organization role "Lite Member"
    When I try to set a team role to "Admin", "Member", or a custom role
    Then the API should reject the update
    And the member team role should remain "Viewer"

  @integration
  Scenario: Lite Member label is shown correctly on member details
    Given I am a Lite Member viewing my own member details
    When I look at the organization role field
    Then I should see "Lite Member"
    And I should not see "EXTERNAL"
