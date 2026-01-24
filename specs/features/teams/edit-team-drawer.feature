@teams @drawer
Feature: Edit Team Drawer
  As a team admin or organization owner
  I want to edit team settings in a drawer without leaving the page
  So that I can manage teams faster with less context switching

  Background:
    Given I am logged in as an organization admin
    And the organization has teams:
      | name        | slug        | members                          |
      | Engineering | engineering | alice@example.com (Admin)        |
      | Design      | design      | bob@example.com (Member)         |
    And I am on the teams settings page

  # ─────────────────────────────────────────────────────────────────────────────
  # Opening and Closing the Drawer
  # ─────────────────────────────────────────────────────────────────────────────

  @integration
  Scenario: Open edit drawer from team row action menu
    When I click the actions menu for team "Engineering"
    And I click "Edit" in the menu
    Then the edit team drawer opens
    And the URL contains "drawer.open=editTeam"
    And the URL contains "drawer.teamId=<engineering-team-id>"

  @integration
  Scenario: Close edit drawer via close button
    Given the edit drawer is open for team "Engineering"
    When I click the drawer close button
    Then the drawer closes
    And the URL no longer contains "drawer.open"
    And I remain on the teams settings page

  @integration
  Scenario: Close edit drawer via Escape key
    Given the edit drawer is open for team "Engineering"
    When I press the Escape key
    Then the drawer closes
    And the URL no longer contains "drawer.open"

  @integration
  Scenario: Close edit drawer by clicking overlay
    Given the edit drawer is open for team "Engineering"
    When I click outside the drawer
    Then the drawer closes

  @integration
  Scenario: Open edit drawer by clicking team name
    When I click the team name "Engineering" in the teams list
    Then the edit team drawer opens
    And the URL contains "drawer.open=editTeam"
    And the URL contains "drawer.teamId=<engineering-team-id>"

  @integration
  Scenario: Team name is visually clickable
    Then the team names in the list are displayed as links
    And hovering over a team name shows a pointer cursor

  # ─────────────────────────────────────────────────────────────────────────────
  # Loading State and Data Pre-fill
  # ─────────────────────────────────────────────────────────────────────────────

  @unit
  Scenario: Display loading state while fetching team data
    When I open the edit drawer for team "Engineering"
    And the team data is still loading
    Then the drawer displays a loading skeleton
    And the form fields are not yet visible

  @integration
  Scenario: Pre-fill form with existing team data
    When I open the edit drawer for team "Engineering"
    And the team data finishes loading
    Then the team name field contains "Engineering"
    And the members list shows:
      | name  | email             | role  |
      | Alice | alice@example.com | Admin |

  @integration
  Scenario: Display team slug as read-only
    Given the edit drawer is open for team "Engineering"
    Then the slug field displays "engineering"
    And the slug field is read-only

  @unit
  Scenario: Handle team data fetch error
    When I open the edit drawer for team "Engineering"
    And the team data fetch fails with "Network error"
    Then an error message displays "Failed to load team data"
    And a "Retry" button is visible

  # ─────────────────────────────────────────────────────────────────────────────
  # Editing Team Name
  # ─────────────────────────────────────────────────────────────────────────────

  @integration
  Scenario: Update team name
    Given the edit drawer is open for team "Engineering"
    When I clear the team name field
    And I enter "Platform Engineering" as the team name
    And I click "Save Changes"
    Then the team is updated successfully
    And a success toast displays "Team updated"
    And the drawer closes
    And the teams list shows "Platform Engineering" instead of "Engineering"

  @unit
  Scenario: Validate team name is required
    Given the edit drawer is open for team "Engineering"
    When I clear the team name field
    And I click "Save Changes"
    Then an error message displays "Team name is required"
    And the drawer remains open

  @unit
  Scenario: Validate team name is not whitespace only
    Given the edit drawer is open for team "Engineering"
    When I clear the team name field
    And I enter "   " as the team name
    And I click "Save Changes"
    Then an error message displays "Team name is required"
    And the drawer remains open

  # ─────────────────────────────────────────────────────────────────────────────
  # Managing Members
  # ─────────────────────────────────────────────────────────────────────────────

  @integration
  Scenario: Add a new member to the team
    Given the edit drawer is open for team "Engineering"
    When I click "Add Another" member
    And I select "charlie@example.com" from the user dropdown
    And I select "Member" as the role
    And I click "Save Changes"
    Then the team is updated with the new member
    And the teams list shows member count "2" for "Engineering"

  @integration
  Scenario: Change an existing member's role
    Given the edit drawer is open for team "Engineering"
    When I change Alice's role from "Admin" to "Member"
    And I click "Save Changes"
    Then Alice's role is updated to "Member"
    And a success toast displays "Team updated"

  @integration
  Scenario: Remove a member from the team
    Given the edit drawer is open for team "Engineering"
    And the team has members:
      | name    | role   |
      | Alice   | Admin  |
      | Charlie | Member |
    When I click the remove button for "Charlie"
    And I click "Save Changes"
    Then Charlie is removed from the team
    And the teams list shows member count "1" for "Engineering"

  @unit
  Scenario: Prevent removing the last member
    Given the edit drawer is open for team "Engineering"
    And the team has only one member "Alice"
    Then the remove button for "Alice" is disabled
    And a tooltip explains "Team must have at least one member"

  @integration
  Scenario: Add member with custom role
    Given the organization has custom roles:
      | name       | description                    |
      | Tech Lead  | Can approve pull requests      |
    And the edit drawer is open for team "Engineering"
    When I click "Add Another" member
    And I select "charlie@example.com" from the user dropdown
    And I select custom role "Tech Lead"
    And I click "Save Changes"
    Then Charlie is added with the "Tech Lead" role

  # ─────────────────────────────────────────────────────────────────────────────
  # Form Validation and Error Handling
  # ─────────────────────────────────────────────────────────────────────────────

  @unit
  Scenario: Display inline validation errors without closing drawer
    Given the edit drawer is open for team "Engineering"
    When I click "Add Another" member
    And I leave the user field empty
    And I click "Save Changes"
    Then an error message displays "User is required"
    And the drawer remains open
    And the form retains all entered data

  @integration
  Scenario: Handle server error during update
    Given the edit drawer is open for team "Engineering"
    When I enter "Design" as the team name
    And I click "Save Changes"
    And the server returns "Team name already exists"
    Then an error toast displays "Team name already exists"
    And the drawer remains open
    And the form retains all entered data

  @integration
  Scenario: Handle network error during update
    Given the edit drawer is open for team "Engineering"
    When I modify the team name
    And I click "Save Changes"
    And the network request fails
    Then an error toast displays "Failed to update team"
    And the drawer remains open
    And I can retry the submission

  # ─────────────────────────────────────────────────────────────────────────────
  # Permissions
  # ─────────────────────────────────────────────────────────────────────────────

  @integration
  Scenario: User with team:manage permission can edit
    Given I have "team:manage" permission
    When I open the edit drawer for team "Engineering"
    Then all form fields are editable
    And the "Save Changes" button is enabled

  @integration
  Scenario: User without team:manage permission sees read-only view
    Given I do not have "team:manage" permission
    When I open the edit drawer for team "Engineering"
    Then all form fields are read-only
    And the "Save Changes" button is not visible
    And a message displays "You don't have permission to edit this team"

  @integration
  Scenario: Edit option hidden for users without permission
    Given I do not have "team:manage" permission
    When I click the actions menu for team "Engineering"
    Then the "Edit" option is not visible

  # ─────────────────────────────────────────────────────────────────────────────
  # List Synchronization
  # ─────────────────────────────────────────────────────────────────────────────

  @integration
  Scenario: Teams list updates immediately after successful edit
    Given the edit drawer is open for team "Engineering"
    When I change the team name to "Platform Engineering"
    And I click "Save Changes"
    And the update succeeds
    Then the drawer closes
    And the teams list immediately shows "Platform Engineering"
    And no page refresh is required

  @integration
  Scenario: Teams list reflects member count changes
    Given the edit drawer is open for team "Engineering"
    When I add two new members to the team
    And I click "Save Changes"
    Then the teams list shows the updated member count

  # ─────────────────────────────────────────────────────────────────────────────
  # Drawer State Management
  # ─────────────────────────────────────────────────────────────────────────────

  @integration
  Scenario: Direct URL access opens edit drawer for specific team
    When I navigate directly to "/settings/teams?drawer.open=editTeam&drawer.teamId=<engineering-id>"
    Then the edit drawer opens for team "Engineering"
    And the form is pre-filled with Engineering team data

  @integration
  Scenario: Invalid team ID in URL shows error
    When I navigate directly to "/settings/teams?drawer.open=editTeam&drawer.teamId=invalid-id"
    Then the drawer shows "Team not found" error
    And a "Close" button is available

  @unit
  Scenario: Preserve form state when losing focus
    Given the edit drawer is open for team "Engineering"
    And I have modified the team name to "New Name"
    When I click somewhere else in the drawer (not a button)
    Then the team name field still contains "New Name"

  # ─────────────────────────────────────────────────────────────────────────────
  # Unsaved Changes Warning
  # ─────────────────────────────────────────────────────────────────────────────

  @integration
  Scenario: Warn when closing drawer with unsaved changes
    Given the edit drawer is open for team "Engineering"
    And I have modified the team name
    When I click the drawer close button
    Then a confirmation dialog appears
    And the dialog asks "Discard unsaved changes?"

  @integration
  Scenario: Confirm discarding unsaved changes
    Given the edit drawer is open for team "Engineering"
    And I have modified the team name
    When I click the drawer close button
    And I confirm discarding changes
    Then the drawer closes
    And the changes are not saved

  @integration
  Scenario: Cancel closing to keep editing
    Given the edit drawer is open for team "Engineering"
    And I have modified the team name
    When I click the drawer close button
    And I cancel the confirmation dialog
    Then the drawer remains open
    And my changes are preserved

  @integration
  Scenario: No warning when closing without changes
    Given the edit drawer is open for team "Engineering"
    And I have not modified any fields
    When I click the drawer close button
    Then the drawer closes immediately
    And no confirmation dialog appears

  # ─────────────────────────────────────────────────────────────────────────────
  # Component Reuse (Shared TeamFormDrawer)
  # ─────────────────────────────────────────────────────────────────────────────

  @unit
  Scenario: Edit drawer reuses TeamForm component
    Given the edit drawer is open for team "Engineering"
    Then the drawer uses the shared TeamForm component
    And the form has the same fields as the create drawer
    And the form has the same validation rules as the create drawer

  @integration
  Scenario: Create and edit drawers have consistent styling
    Given the create team drawer is open
    When I note the drawer layout and field positioning
    And I close the create drawer
    And I open the edit drawer for team "Engineering"
    Then the layout and field positioning match the create drawer
    And the button placement is consistent
