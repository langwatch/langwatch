Feature: Change password for Auth0-authenticated users
  As a LangWatch customer whose tenant uses Auth0 as the sign-in provider
  I want to change my password from /settings/authentication without leaving the app
  So that I don't have to trigger a reset-via-email flow every time

  Background:
    Given the tenant is configured with NEXTAUTH_PROVIDER="auth0"
    And AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, and AUTH0_ISSUER are set
    And the Auth0 application has Client Access authorized for the Auth0 Management API
    And the Management API authorization includes scopes "read:users" and "update:users"
    And I am signed in through Auth0 with a database-connection account
    And I am on /settings/authentication

  # The Auth0 mode does NOT verify the current password against Auth0 — modern
  # Auth0 tenants don't expose the Resource Owner Password Grant required for
  # that. Identity is proven by the authenticated app session and the
  # 5-attempts-per-15-minutes rate limit; an additional confirmation step
  # could be added later via Auth0 Actions / MFA step-up.

  @integration
  Scenario: Change Password form renders for Auth0 users
    Then I see a "Change Password" section
    And the form has New Password and Confirm New Password fields
    And the form does not show a Current Password field
    And the form has a "Change Password" submit button

  @integration
  Scenario: Successful password change via Auth0 Management API
    When I enter a new password of at least 8 characters
    And I confirm the new password
    And I submit the form
    Then the server obtains a Management API token via client_credentials grant
    And the server updates the password via Auth0 Management API PATCH /api/v2/users/{id}
    And I see a "Password changed successfully" toast
    And the form is reset

  @integration
  Scenario: Enforces client-side minimum length on new password
    When I enter a new password shorter than 8 characters
    Then the form shows "Password must be at least 8 characters"
    And the form cannot be submitted

  @integration
  Scenario: Enforces confirm-password match on the client
    When I enter a new password and a different confirm value
    Then the form shows "Passwords don't match"
    And the form cannot be submitted

  @integration
  Scenario: Rate limits password change attempts
    Given I have submitted 5 password change attempts in the last 15 minutes
    When I submit another password change attempt
    Then I see a "Too many password change attempts" error
    And the server does not call Auth0

  @integration
  Scenario: Surfaces a clear error when Auth0 Management API scope is missing
    Given the Auth0 application is missing the "update:users" Management API scope
    When I submit the form with a valid new password
    Then the Management API PATCH call returns 403 "insufficient_scope"
    And the server logs the scope error
    And I see an error toast indicating the Auth0 app is not authorized

  @regression @integration
  Scenario: Email-provider tenants still use the BetterAuth flow with current password
    Given the tenant is configured with NEXTAUTH_PROVIDER="email"
    And I am signed in with a credential account
    Then the form shows the Current Password field
    When I submit the Change Password form with a correct current password and a valid new password
    Then the server updates the BetterAuth credential password in the database
    And the server revokes other sessions for the user
    And I see a "Password changed successfully" toast

  @regression @integration
  Scenario: Email-provider tenants reject empty current password
    Given the tenant is configured with NEXTAUTH_PROVIDER="email"
    When I submit the Change Password form with no current password
    Then I see an error toast indicating the current password is required
