Feature: Invitation Approval Workflow
  As a member of an organization
  I want to request invitations for new users
  So that admins can approve them and new collaborators can join

  # ============================================================================
  # E2E: Happy Paths - Full User Workflows
  # ============================================================================

  @e2e
  Scenario: Member creates an invitation request that requires approval
    Given I am logged in as a "MEMBER"
    And I am on the members page
    When I invite "newuser@example.com" with role "MEMBER"
    Then I see a success message "Invitation sent for approval"
    And the invitation for "newuser@example.com" appears in the "Invites" list with a "Pending Approval" badge

  @e2e
  Scenario: Admin creates an immediate invite
    Given I am logged in as an "ADMIN"
    And I am on the members page
    When I invite "direct@example.com" with role "MEMBER"
    Then I see a success message "Invitations sent"
    And the invitation for "direct@example.com" appears in the "Invites" list with an "Invited" badge

  @e2e
  Scenario: Admin approves an invitation request
    Given I am logged in as an "ADMIN"
    And there is a pending approval request for "waiting@example.com"
    When I go to the members page
    And I approve the invitation for "waiting@example.com"
    Then I see a success message "Invitation approved"
    And the invitation for "waiting@example.com" appears in the "Invites" list with an "Invited" badge

  @e2e
  Scenario: Admin rejects an invitation request
    Given I am logged in as an "ADMIN"
    And there is a pending approval request for "reject@example.com"
    When I go to the members page
    And I reject the invitation for "reject@example.com"
    Then I see a success message "Invitation rejected"
    And the invitation for "reject@example.com" is removed from the "Invites" list

  # ============================================================================
  # Integration: Backend Edge Cases, Error Handling, and Rendered Components
  # ============================================================================

  @integration
  Scenario: Member cannot request invitation with ADMIN role
    Given I am authenticated as a "MEMBER" of the organization
    When I request an invitation for "user@example.com" with role "ADMIN"
    Then the request fails with a validation error
    And the error indicates the role is not allowed

  @integration
  Scenario: Member request sets requestedBy to the requesting user
    Given I am authenticated as a "MEMBER" of the organization
    When I request an invitation for "user@example.com" with role "MEMBER"
    Then the invitation is queued for admin approval
    And the invitation records who requested it

  @integration
  Scenario: Invitation request has no expiration while awaiting approval
    Given I am authenticated as a "MEMBER" of the organization
    When I request an invitation for "user@example.com" with role "MEMBER"
    Then the invitation does not expire while waiting for admin approval

  @integration
  Scenario: Approving an invitation sets expiration and status
    Given there is a "WAITING_APPROVAL" invitation for "user@example.com"
    And I am authenticated as an "ADMIN" of the organization
    When I approve the invitation for "user@example.com"
    Then the invitation becomes ready for the invited user to accept
    And the invitation expires after a 48-hour invite window

  @integration
  Scenario: No email is sent when a member creates an invitation request
    Given I am authenticated as a "MEMBER" of the organization
    When I request an invitation for "user@example.com" with role "MEMBER"
    Then no invitation email is sent to "user@example.com"

  @integration
  Scenario: Email is sent when admin approves an invitation request
    Given there is a "WAITING_APPROVAL" invitation for "user@example.com"
    And I am authenticated as an "ADMIN" of the organization
    When I approve the invitation for "user@example.com"
    Then an invitation email is sent to "user@example.com"

  @integration
  Scenario: WAITING_APPROVAL invites count toward license member limits
    Given the organization has reached its member limit
    And there is a pending approval invitation
    When I invite user "new@example.com" to the organization
    Then the invitation request is rejected because the member limit was reached

  @integration
  Scenario: Duplicate detection across PENDING and WAITING_APPROVAL statuses
    Given there is a "WAITING_APPROVAL" invitation for "existing@example.com"
    And I am authenticated as a "MEMBER" of the organization
    When I request an invitation for "existing@example.com" with role "MEMBER"
    Then the request fails with a duplicate invitation error

  @integration
  Scenario: Admin batch invite creates all records before sending any emails
    Given I am authenticated as an "ADMIN" of the organization
    When I invite multiple users in a single batch
    Then all invite records are created atomically
    And emails are sent only after all records are persisted

  @integration
  Scenario: Email failure during approval does not revert the approval
    Given there is a "WAITING_APPROVAL" invitation for "user@example.com"
    And I am authenticated as an "ADMIN" of the organization
    And the email service is unavailable
    When I approve the invitation for "user@example.com"
    Then the invitation is still approved
    And the invite link is shown as fallback

  @integration
  Scenario: Deleting a WAITING_APPROVAL invitation works the same as PENDING
    Given there is a "WAITING_APPROVAL" invitation for "remove@example.com"
    And I am authenticated as an "ADMIN" of the organization
    When I delete the invitation for "remove@example.com"
    Then the invitation is removed successfully

  @integration
  Scenario: Non-admin cannot approve invitations
    Given there is a "WAITING_APPROVAL" invitation for "user@example.com"
    And I am authenticated as a "MEMBER" of the organization
    When I try to approve the invitation for "user@example.com"
    Then the request fails with a permission error

  @integration
  Scenario: Non-admin sees only their own pending approval requests
    Given I am a "MEMBER" user on the members page
    And there are pending approval requests from multiple users
    When I view the "Invites" list
    Then I only see pending approval requests that I created

  @integration
  Scenario: Admin sees all pending approval requests
    Given I am an "ADMIN" user on the members page
    And there are pending approval requests from multiple users
    When I view the "Invites" list
    Then I see all pending approval requests

  @integration
  Scenario: Pending approval requests display a badge
    Given I am an "ADMIN" user on the members page
    And there is a pending approval request for "newuser@example.com"
    When I view the "Invites" list
    Then the invitation for "newuser@example.com" shows a "Pending Approval" badge

  @integration
  Scenario: Sent invites display a badge
    Given I am an "ADMIN" user on the members page
    And there is a sent invite for "newuser@example.com"
    When I view the "Invites" list
    Then the invitation for "newuser@example.com" shows an "Invited" badge

  # ============================================================================
  # Unit: Pure Logic and Display Branches
  # ============================================================================

  @unit
  Scenario: Pending invites query returns both PENDING and WAITING_APPROVAL invites
    Given there is a "PENDING" invitation for "pending@example.com"
    And there is a "WAITING_APPROVAL" invitation for "waiting@example.com"
    When I query the organization's pending invites
    Then the results include "pending@example.com"
    And the results include "waiting@example.com"

  @unit
  Scenario: Non-admin user sees restricted role options in invite form
    Given I am a "MEMBER" user viewing the invite form
    When I view the role dropdown options
    Then I see "Member" and "Lite Member" as role options
    And I do not see "Admin" as a role option

  @unit
  Scenario: Admin user sees all role options in invite form
    Given I am an "ADMIN" user viewing the invite form
    When I view the role dropdown options
    Then I see "Admin", "Member", and "Lite Member" as role options

  @unit
  Scenario: Non-admin sees no action buttons for pending requests
    Given I am a "MEMBER" user on the members page
    And I have a pending approval request
    When I view my pending approval request
    Then I do not see approve or reject buttons

  @unit
  Scenario: Admin sees approve and reject buttons for pending requests
    Given I am an "ADMIN" user on the members page
    And there is a pending approval request
    When I view the pending approval request
    Then I see an "Approve" button
    And I see a "Reject" button
