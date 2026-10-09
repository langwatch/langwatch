@unit
Feature: Disable Self-Registration via Environment Variable
  As a self-hosted LangWatch administrator
  I want to prevent new users from creating accounts
  So that only users I provision can access my instance

  Background:
    Given LangWatch is running in self-hosted mode

  # ============================================================================
  # Registration disabled
  # ============================================================================

  Scenario: Registration is blocked when LANGWATCH_DISABLE_REGISTRATION is set
    Given LANGWATCH_DISABLE_REGISTRATION is "true"
    When an anonymous user submits the sign-up form
    Then the request is rejected with a 403 error
    And the response message says "Account registration is disabled on this instance"

  Scenario: Registration API endpoint is blocked when env var is set
    Given LANGWATCH_DISABLE_REGISTRATION is "true"
    When a POST request is made to the auth sign-up endpoint
    Then the response status is 403
    And no new user or organization is created in the database

  Scenario: Sign-up page is hidden when registration is disabled
    Given LANGWATCH_DISABLE_REGISTRATION is "true"
    When an anonymous user navigates to the sign-up page
    Then they are redirected to the sign-in page
    And no sign-up link is shown in the UI

  # ============================================================================
  # Existing users unaffected
  # ============================================================================

  Scenario: Existing users can still sign in when registration is disabled
    Given LANGWATCH_DISABLE_REGISTRATION is "true"
    And a user with email "admin@acme.com" already exists
    When that user signs in with valid credentials
    Then the sign-in succeeds
    And the user reaches the dashboard

  Scenario: SSO-provisioned users can still sign in when registration is disabled
    Given LANGWATCH_DISABLE_REGISTRATION is "true"
    And an organization with ssoDomain "acme.com" exists
    And a user with email "existing@acme.com" already exists
    When that user signs in via the SSO provider
    Then the sign-in succeeds

  # ============================================================================
  # Registration enabled by default
  # ============================================================================

  Scenario: Registration is allowed when LANGWATCH_DISABLE_REGISTRATION is not set
    Given LANGWATCH_DISABLE_REGISTRATION is not set
    When an anonymous user submits the sign-up form with valid details
    Then a new user and organization are created
    And the user is signed in

  Scenario: Registration is allowed when LANGWATCH_DISABLE_REGISTRATION is "false"
    Given LANGWATCH_DISABLE_REGISTRATION is "false"
    When an anonymous user submits the sign-up form with valid details
    Then a new user and organization are created
    And the user is signed in

  # ============================================================================
  # UI feedback
  # ============================================================================

  Scenario: Sign-in page hides the "Create account" link when registration is disabled
    Given LANGWATCH_DISABLE_REGISTRATION is "true"
    When an anonymous user visits the sign-in page
    Then the sign-in form is shown
    And there is no "Create an account" or "Sign up" link visible

  Scenario: Sign-in page shows the "Create account" link when registration is enabled
    Given LANGWATCH_DISABLE_REGISTRATION is not set
    When an anonymous user visits the sign-in page
    Then a "Create an account" or "Sign up" link is visible
