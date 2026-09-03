Feature: Change password from /settings/authentication
  As a LangWatch user (whether the tenant uses Auth0 or BetterAuth credentials)
  I want a single, clear way to change my password without leaving the settings page
  So that the action is intentional, the page stays uncluttered, and toast feedback confirms success

  # The Change Password entry point lives where it makes sense for each mode:
  #   * Auth0 mode:  next to the database (Email/Password) identity in the
  #                  Linked Sign-in Methods list. Hidden for social-only users.
  #   * Email mode:  a dedicated "Change Password" section (since email-mode
  #                  doesn't render a Linked Sign-in Methods list).
  # In both modes, clicking the entry point opens the same dialog. The dialog
  # always asks for the current password — required for both modes — to defend
  # against a stolen session being used to lock the real owner out.

  Background:
    Given I am signed in
    And I am on /settings/authentication

  @integration
  Scenario: Auth0 user with a database identity sees the Change Password link in their linked sign-in row
    Given the tenant runs on NEXTAUTH_PROVIDER="auth0"
    And my Auth0 identity is "Email/Password (via auth0)"
    Then I see "Change Password" next to that identity
    And I do not see any password input until I click it

  @integration
  Scenario: Auth0 social-only user (Google via Auth0) does not see Change Password
    Given the tenant runs on NEXTAUTH_PROVIDER="auth0"
    And my only Auth0 identity is "Google (via auth0)"
    Then I do not see a Change Password entry point

  @integration
  Scenario: Email/credential user sees a dedicated Change Password section with just a button
    Given the tenant runs on NEXTAUTH_PROVIDER="email"
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

  # The refusal the server AUTHORED and the one it did not are two different
  # sentences, and the difference is deliberate (#5984). A non-5xx rejection the
  # procedure wrote for a reader travels and is shown; a 500's message names
  # Auth0 scopes and environment variables, which is an operator's detail, and
  # degrades to the action that failed plus the generic line.
  @integration
  Scenario: Wrong current password keeps the dialog open and shows an error
    When I open the dialog
    And I submit an incorrect current password
    Then the server returns "Current password is incorrect"
    And I see a "Couldn't change your password" notice carrying that sentence
    And the dialog stays open so I can retry

  @integration
  Scenario: Server error keeps the dialog open and shows the error
    When I open the dialog
    And the server returns an unexpected error on submit
    Then I see a "Couldn't change your password" notice with the generic explanation
    And nothing the server wrote is shown to me
    And the dialog stays open so I can retry

  # ── The linked sign-in methods list ────────────────────────────────────────

  @integration
  Scenario: The only linked sign-in method offers no way to remove it
    Given my account holds exactly one linked sign-in method
    Then no control to remove it is offered
    Because the server refuses the last account under a serializable transaction,
      and the affordance should say so before the click rather than after it

  @integration
  Scenario: An organization on single sign-on links and removes nothing
    Given my organization is pinned to a single sign-on provider
    Then I am told my company's provider signs me in
    And neither linking nor removing a method is offered,
      because a second way in would route around the provider the organization chose

  @integration
  Scenario: Removing a linked sign-in method re-reads the list
    Given my account holds two linked sign-in methods
    When I remove one
    Then the account id is sent, the list is asked for again,
      and I am told the method was removed

  @integration
  Scenario: Linking an additional sign-in method goes through the account-linking route
    When I link another sign-in method
    Then the request goes to the account-linking endpoint as the signed-in reader,
      never through a fresh sign-in that could silently switch accounts
    And the provider id the product names differently is mapped to the one
      the identity library registered
    And a refusal from the provider is shown with its own reason

  # A credential typed into a text field is one over-the-shoulder glance and one
  # screen recording away from being somebody else's.
  @integration
  Scenario: Every password field on the page masks what is typed into it
    When I open the dialog
    Then Current Password, New Password and Confirm New Password are all masked

  # Everything on this page is keyed on the reader's own account, so there is no
  # scope to hold a grant over. A page-level refusal here would leave a member
  # with no way to change their own password.
  @integration
  Scenario: Every signed-in reader can open their own sign-in methods
    Given I hold no organization or project permissions at all
    When I open /settings/authentication
    Then the page opens
    And it is framed in the settings chrome

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
    Given AUTH0_MGMT_CLIENT_ID and AUTH0_MGMT_CLIENT_SECRET are set
    And the Management M2M application has the "Password" grant type enabled
    When the server processes a change-password submission for an Auth0 user
    Then it calls Auth0 /oauth/token with grant_type=password using the M2M credentials
    And on a 200 it requests a Management API token via client_credentials
    And it calls Auth0 Management API PATCH /api/v2/users/{id} with the new password
    And the connection field is "Username-Password-Authentication"

  @integration
  Scenario: Auth0 backend returns 401 UNAUTHORIZED when the current password is wrong
    Given AUTH0_MGMT_CLIENT_ID and AUTH0_MGMT_CLIENT_SECRET are set
    When the server submits the wrong current password to Auth0
    Then Auth0 responds with error=invalid_grant
    And the server does NOT call the Management API
    And the tRPC mutation throws UNAUTHORIZED with message "Current password is incorrect"

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
    Given AUTH0_MGMT_CLIENT_ID and AUTH0_MGMT_CLIENT_SECRET are not set
    And AUTH0_CLIENT_ID and AUTH0_CLIENT_SECRET are set
    When the server processes a successful change-password submission for an Auth0 user
    Then it uses AUTH0_CLIENT_ID/SECRET for the client_credentials grant

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
  #   * `revokeOtherSessionsForUser` — `revokeSessions.test.ts`
  #   * BetterAuth credential update — covered by `auth.test.ts` paths
  # but no test exercises the `user.changePassword` mutation in email
  # mode end-to-end. Leaving `@unimplemented` until the router test
  # exists.
  @regression @integration @unimplemented
  Scenario: Email-provider mode continues to verify the current password and revoke other sessions
    Given the tenant runs on NEXTAUTH_PROVIDER="email"
    When I submit the dialog with a correct current password and a valid new password
    Then the server updates the BetterAuth credential password in the database
    And the server revokes other sessions for the user
    And I see a "Password changed successfully" toast
