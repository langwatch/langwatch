Feature: License-Gated SSO

  # Decision of record: dev/docs/adr/027-license-gated-sso.md (Accepted, v6).
  # Implemented in PR #4830.
  #
  # Behavior, not internals: scenarios describe what an operator / user / admin
  # observes, never gate function names or config field values.
  #
  # Vocabulary:
  #   - "SSO" = any non-email login provider (google, github, gitlab,
  #     azure-ad, okta, auth0) plus per-org domain auto-join.
  #   - "genuine license" = a stored license whose signature verifies.
  #     Expiry is deliberately irrelevant to SSO: once a customer, never
  #     blocked. (Plan limits still expire; only login federation doesn't.)
  #   - "instance license key" = the LANGWATCH_LICENSE_KEY environment value.
  #   - The gate is decided once at startup: license changes take effect on
  #     the next server restart, never mid-flight.

  As a LangWatch operator and as a person signing in
  I want SSO to be available only on deployments that were ever licensed, with a safe way back in
  So that login federation is a paid feature without ever locking a customer out

  # ============================================================================
  # Platform gate — self-hosted
  # ============================================================================

  @unit
  Scenario: Self-hosted with a genuine org license keeps SSO working with zero action
    Given a self-hosted deployment configured with an enterprise IdP
    And at least one organization holds a genuine license
    And no instance license key is set
    When a user opens the sign-in page
    Then they are taken to the identity provider as before
    And the email and password form is not offered

  @unit
  Scenario: An expired but genuine license still keeps SSO working
    Given a self-hosted deployment configured with an enterprise IdP
    And the only organization license is genuine but past its expiry date
    When the server restarts and a user opens the sign-in page
    Then they are taken to the identity provider as before
    And the server logs a renewal reminder naming the expired license

  @unit
  Scenario: Self-hosted that never had a license hides SSO and offers email sign-in
    Given a self-hosted deployment configured with an enterprise IdP
    And no organization holds a genuine license
    And no instance license key is set
    When a user opens the sign-in page
    Then the identity provider button is not shown
    And the email and password form is offered

  @unit
  Scenario: A tampered license does not enable SSO
    Given a self-hosted deployment configured with an enterprise IdP
    And the only stored license fails signature verification
    When a user opens the sign-in page
    Then the identity provider button is not shown
    And the server logs which license was inspected and why it was rejected

  @unit
  Scenario: SSO sign-in routes are refused while the deployment is unlicensed
    Given a self-hosted deployment configured with an enterprise IdP
    And no organization holds a genuine license
    When a request is made directly to an SSO sign-in, link, or callback route
    Then the request is refused
    And this holds for the legacy provider callback paths as well

  @integration
  Scenario: Activating a license takes effect at the next restart
    Given an unlicensed self-hosted deployment running in email mode
    When an admin activates a genuine organization license in settings
    Then SSO remains unavailable until the server restarts
    And the activation flow tells the admin a restart is required
    And after the restart SSO is available

  # ============================================================================
  # Recovery — the no-lockout guarantee
  # ============================================================================

  @unit
  Scenario: An SSO-only deployment recovers by setting the instance license key
    Given a self-hosted deployment where every user signs in only through SSO
    And the deployment has no genuine license stored
    When the operator sets a genuine instance license key and restarts
    Then SSO becomes available again
    And no password and no outbound email were required to recover

  @unit
  Scenario: Existing users on an unlicensed deployment self-recover via password reset
    Given an unlicensed self-hosted deployment previously using SSO
    And an existing user whose account was created through SSO and has no password
    And outbound email is configured
    When that user requests a password reset and completes it from their inbox
    Then they can sign in with their email and new password

  @unit
  Scenario: A fresh unlicensed deployment bootstraps via email signup
    Given a fresh self-hosted deployment with no license
    When an operator signs up with email and password
    And activates an organization license in settings
    And restarts the server
    Then SSO is available

  # ============================================================================
  # Fail-closed and anti-takeover
  # ============================================================================

  @unit
  Scenario: A licensed deployment cannot mint password accounts
    Given a self-hosted deployment configured with an enterprise IdP
    And at least one organization holds a genuine license
    When anyone attempts email sign-up, email sign-in, or a password reset
    Then each attempt is refused
    And sign-in remains possible only through the identity provider

  @unit
  Scenario: No password can be attached to an SSO account without inbox proof
    Given a deployment configured with an enterprise IdP
    And an existing user who has only an SSO credential
    When anyone attempts to set or change a password for that user without a valid emailed reset token
    Then the attempt is refused
    And this holds whether the deployment is licensed or not

  @unit
  Scenario: Unlicensed-mode signup does not auto-join a domain-matched organization
    Given an unlicensed self-hosted deployment running in email mode
    And an organization configured with a matching SSO domain
    When a new user signs up with an email address on that domain
    Then the account is created
    And the user is not added to that organization

  @unit
  Scenario: A licensing-store outage refuses SSO and heals itself
    Given a self-hosted deployment with a genuine license
    And the licensing store cannot be reached during the first sign-in attempt
    When the store becomes reachable again
    Then the next sign-in attempt through the identity provider succeeds
    And no restart was required

  @unit
  Scenario: Existing sessions keep working across a gate change
    Given a signed-in user on a deployment that loses its license and restarts
    Then their existing session continues to work
    And only new sign-in attempts are subject to the gate

  # ============================================================================
  # SaaS and multi-org
  # ============================================================================

  @unit
  Scenario: SaaS is unaffected by license gating
    Given the deployment is LangWatch Cloud
    When a user opens the sign-in page
    Then SSO is available regardless of any organization's plan or license

  @unit
  Scenario: One organization's genuine license enables SSO for the whole deployment
    Given a self-hosted deployment hosting two organizations
    And only the first organization holds a genuine license
    When a member of the second organization signs in
    Then they can use the identity provider like everyone else

  # ============================================================================
  # Observability
  # ============================================================================

  @unit
  Scenario: Denied SSO is explained in the server logs
    Given a self-hosted deployment configured with an enterprise IdP
    And no genuine license anywhere
    When the server evaluates the gate and refuses an SSO attempt
    Then the logs say SSO is configured but no genuine license was found
    And name how to enable it
    And each refused SSO request is logged with its path and reason
