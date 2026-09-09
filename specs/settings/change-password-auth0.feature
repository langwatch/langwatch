Feature: Change password from /settings/security
  As a LangWatch user (whether the tenant uses Auth0 or BetterAuth credentials)
  I want a single, clear way to change my password without leaving the settings page
  So that the action is intentional, the page stays uncluttered, and toast feedback confirms success

  # The password is always its own section on /settings/security, never a row
  # inside the linked sign-in methods list — a password is something I choose
  # and change, a linked account is something I connect and disconnect. The
  # section only offers a change where there is a password to change:
  #   * Auth0 mode: only when my account holds a database (Email/Password)
  #                 identity. Hidden for social-only users.
  #   * Email mode: always — the password is mine to manage directly.
  # In both modes, clicking the entry point opens the same dialog. The dialog
  # always asks for the current password — required for both modes — to defend
  # against a stolen session being used to lock the real owner out.

  Background:
    Given I am signed in
    And I am on /settings/security

  @integration
  Scenario: Auth0 user with a database identity sees the Change Password link in their linked sign-in row
    Given my deployment authenticates through Auth0
    And I hold an Email/Password identity there
    Then I see "Change Password" in the password section
    And I do not see any password input until I click it

  @integration
  Scenario: Auth0 social-only user (Google via Auth0) does not see Change Password
    Given my deployment authenticates through Auth0
    And I signed up with Google and hold no Email/Password identity
    Then I do not see a Change Password entry point

  @integration
  Scenario: Email/credential user sees a dedicated Change Password section with just a button
    Given my deployment authenticates with an email and password directly, not through Auth0
    Then I see a Change Password section
    And the section shows a "Change Password" button but no inline form

  @integration
  Scenario: The dialog asks for current + new password in both modes
    When I click the Change Password entry point
    Then a dialog opens
    And the dialog shows Current Password, New Password, and Confirm New Password fields

  @integration
  Scenario: Successful change shows a toast and closes the dialog
    When I open the dialog
    And I submit a valid current password and a valid new password with matching confirmation
    Then the server changes my password
    And I see a "Password changed successfully" toast
    And the dialog closes

  @integration
  Scenario: Wrong current password keeps the dialog open and shows an error
    When I open the dialog
    And I submit an incorrect current password
    Then the server returns "Current password is incorrect"
    And I see a "Failed to change password" toast with that message
    And the dialog stays open so I can retry

  @integration
  Scenario: Server error keeps the dialog open and shows the error
    When I open the dialog
    And the server returns an unexpected error on submit
    Then I see a "Failed to change password" toast with the server's message
    And the dialog stays open so I can retry

  @integration
  Scenario: Cancel button closes the dialog without submitting
    When I open the dialog
    And I click Cancel
    Then the dialog closes
    And the server is not called

  @integration
  Scenario: Reopening the dialog clears any previously-typed values
    When I open the dialog and type a new password
    And I close the dialog without submitting
    And I open the dialog again
    Then the New Password field is empty

  # Backend (Auth0 mode)

  @integration
  Scenario: Auth0 backend verifies the current password via Resource Owner Password Grant before updating
    Given my deployment's Auth0 management application is set up to verify passwords
    And that application is allowed to check a password directly
    When the server processes a change-password submission for an Auth0 user
    Then it verifies the current password against Auth0 before accepting the change
    And only once that succeeds does it request elevated access to update the record
    And it updates the password on the Auth0 database connection the user signed up with

  @integration
  Scenario: Auth0 backend returns 401 UNAUTHORIZED when the current password is wrong
    Given my deployment's Auth0 management application is set up to verify passwords
    When the server submits the wrong current password to Auth0
    Then Auth0 rejects the current password
    And the server does NOT go on to update the record
    And the change is refused as unauthorized with the message "Current password is incorrect"

  # The two `@unimplemented` scenarios below describe behaviour that is
  # implemented in the source but has no asserting test:
  #   * AUTH0_CLIENT_ID/SECRET fallback path:
  #     `passwordService.ts` reads
  #     `env.AUTH0_MGMT_CLIENT_ID ?? env.AUTH0_CLIENT_ID` (and the secret
  #     mirror), but the existing
  #     `passwordService.integration.test.ts` only mocks
  #     `AUTH0_CLIENT_ID/SECRET` and does not assert which env var the
  #     service picked. A binding test would need to vary the env
  #     surface between two test runs.
  #   * Rate limit (5/15min) — implemented in the `user.changePassword`
  #     tRPC mutation against a Redis-backed limiter; no router-level
  #     integration test exercises the limiter today.
  @integration @unimplemented
  Scenario: Auth0 backend falls back to AUTH0_CLIENT_ID/SECRET when the M2M vars are absent
    Given my deployment has not set up a dedicated management application for password checks
    And its regular Auth0 application credentials are configured instead
    When the server processes a successful change-password submission for an Auth0 user
    Then it uses those regular application credentials to request elevated access

  @integration @unimplemented
  Scenario: Rate limit applies to both modes
    Given I have submitted 5 password change attempts in the last 15 minutes
    When I submit another password change attempt
    Then I see a "Too many password change attempts" error
    And the server does not contact Auth0 or update the credential password

  @integration
  Scenario: Surfaces a clear error when the Auth0 Management API scope is missing
    Given the M2M application is missing the "update:users" Management API scope
    When I submit a valid current and new password in Auth0 mode
    Then the Management API PATCH call returns 403 "insufficient_scope"
    And the server logs the scope error
    And I see an error toast indicating the Auth0 app is not authorized

  @integration
  Scenario: Surfaces a clear error when the Auth0 Password grant is missing on the M2M app
    Given the Management M2M application does not have the "Password" grant enabled
    When I submit a current and new password in Auth0 mode
    Then Auth0 /oauth/token returns unauthorized_client
    And the server logs the grant-misconfig error
    And I see an error toast telling an administrator to enable the Password grant

  # The email-mode end-to-end flow (router-level test that wires
  # together password verification + Prisma update + session revoke)
  # has no integration test today. The pieces are tested individually:
  #   * BetterAuth credential update — covered by `auth.test.ts` paths
  # but no test exercises the `user.changePassword` mutation in email
  # mode end-to-end. Leaving `@unimplemented` until the router test
  # exists.
  @regression @integration @unimplemented
  Scenario: Email-provider mode continues to verify the current password and revoke other sessions
    Given my deployment authenticates with an email and password directly, not through Auth0
    When I submit the dialog with a correct current password and a valid new password
    Then the server updates the BetterAuth credential password in the database
    And the server revokes other sessions for the user
    And I see a "Password changed successfully" toast
