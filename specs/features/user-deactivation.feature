Feature: User Deactivation
  As a LangWatch platform admin
  I want to deactivate and reactivate user accounts
  So that I can revoke access for users who should no longer use the platform
  without permanently deleting their data

  # ─── Admin UI ───────────────────────────────────────────────────────────────

  @integration
  Scenario: Admin sees Deactivate button for an active user in the admin panel
    Given the admin panel user list is rendered with an active user
    When the user row is displayed
    Then a "Deactivate" button is visible for that user
    And no "Deactivated" badge is shown for that user

  @integration
  Scenario: Admin sees Reactivate button and Deactivated badge for a deactivated user
    Given the admin panel user list is rendered with a deactivated user
    When the user row is displayed
    Then a "Reactivate" button is visible for that user
    And a "Deactivated" badge is shown for that user

  @integration
  Scenario: Admin deactivates a user via the admin panel
    Given the admin panel user list is rendered with an active user
    When the admin clicks "Deactivate" for that user
    Then the user.deactivate mutation is called with the user's id
    And the user row updates to show the "Deactivated" badge
    And the "Reactivate" button replaces the "Deactivate" button

  @integration
  Scenario: Admin reactivates a deactivated user via the admin panel
    Given the admin panel user list is rendered with a deactivated user
    When the admin clicks "Reactivate" for that user
    Then the user.reactivate mutation is called with the user's id
    And the user row no longer shows the "Deactivated" badge
    And the "Deactivate" button replaces the "Reactivate" button

  # ─── tRPC mutations ─────────────────────────────────────────────────────────

  @unit
  Scenario: user.deactivate sets deactivatedAt on the user
    Given a user exists with deactivatedAt null
    When an admin calls user.deactivate with that user's id
    Then the user's deactivatedAt is set to the current timestamp

  @unit
  Scenario: user.reactivate clears deactivatedAt on the user
    Given a user exists with a non-null deactivatedAt
    When an admin calls user.reactivate with that user's id
    Then the user's deactivatedAt is set to null

  @unit
  Scenario: user.deactivate is rejected for non-admin callers
    Given a non-admin authenticated user
    When they call user.deactivate with any user id
    Then a FORBIDDEN tRPC error is returned

  @unit
  Scenario: user.reactivate is rejected for non-admin callers
    Given a non-admin authenticated user
    When they call user.reactivate with any user id
    Then a FORBIDDEN tRPC error is returned

  # ─── Organization member queries ────────────────────────────────────────────

  @unit
  Scenario: getAllOrganizationMembers excludes deactivated users
    Given an organization has two members, one of whom is deactivated
    When getAllOrganizationMembers is called
    Then only the active member is returned

  @unit
  Scenario: getOrganizationWithMembersAndTheirTeams excludes deactivated users by default
    Given an organization has two members, one of whom is deactivated
    When getOrganizationWithMembersAndTheirTeams is called
    Then only the active member is included in the members list

  # ─── Settings dropdowns ─────────────────────────────────────────────────────

  @integration
  Scenario: TeamForm member dropdown omits deactivated users
    Given an organization has an active user and a deactivated user
    When the TeamForm member selection dropdown is rendered
    Then only the active user appears in the dropdown options
    And the deactivated user does not appear

  @integration
  Scenario: AddParticipants dropdown omits deactivated users
    Given an organization has an active user and a deactivated user
    When the AddParticipants dropdown is rendered
    Then only the active user appears in the dropdown options
    And the deactivated user does not appear

  @integration
  Scenario: AddAnnotationQueueDrawer assignee dropdown omits deactivated users
    Given an organization has an active user and a deactivated user
    When the AddAnnotationQueueDrawer assignee dropdown is rendered
    Then only the active user appears in the dropdown options
    And the deactivated user does not appear

  # ─── Settings members list ───────────────────────────────────────────────────

  @integration
  Scenario: Settings members list shows deactivated users with a Deactivated badge
    Given an organization has an active member and a deactivated member
    When the settings members page is rendered
    Then both members are listed
    And the deactivated member's row shows a "Deactivated" badge
    And the active member's row does not show a "Deactivated" badge

  # ─── Auth – login blocking ───────────────────────────────────────────────────

  @unit
  Scenario: Deactivated user is blocked from signing in
    Given a user account with a non-null deactivatedAt
    When the NextAuth signIn callback runs for that user
    Then the callback returns false, denying login

  @unit
  Scenario: Active user is not blocked from signing in
    Given a user account with deactivatedAt null
    When the NextAuth signIn callback runs for that user
    Then the deactivation check does not block the sign-in
