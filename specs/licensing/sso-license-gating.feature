@wip
Feature: License-Gated SSO

  # Decision of record: dev/docs/adr/027-license-gated-sso.md (Accepted).
  # Ships across a stacked set of PRs on top of #4830:
  #   PR-1 licensing primitives, PR-2 gate module, PR-3 platform enforcement,
  #   PR-4 per-org gates. All scenarios are @unimplemented until their PR lands;
  #   each will bind to the integration/unit harness noted in its phase doc.
  #
  # Behavior, not internals: scenarios describe what an operator / user / admin
  # observes, never "canPlatformSSO returns false" or config field values.
  #
  # Vocabulary:
  #   - "SSO" = any non-email login provider (google, github, gitlab,
  #     azure-ad, okta, cognito, auth0) plus per-org domain auto-join.
  #   - "active license" = a stored license whose signature verifies and
  #     has not expired (never the cached expiry column).
  #   - "instance license key" = the LANGWATCH_LICENSE_KEY environment value.

  As a LangWatch operator and as a person signing in
  I want SSO to be available only on paying deployments, with a safe way back in
  So that login federation is a paid feature without ever locking anyone out

  # ============================================================================
  # Platform gate — self-hosted (PR-3)
  # ============================================================================

  @unimplemented
  Scenario: Self-hosted with an active org license keeps SSO working
    Given a self-hosted deployment configured with an enterprise IdP
    And at least one organization holds an active license
    When a user opens the sign-in page
    Then they are taken to the identity provider as before
    And the email and password form is not offered

  @unimplemented
  Scenario: Self-hosted with no license hides SSO and offers email sign-in
    Given a self-hosted deployment configured with an enterprise IdP
    And no organization holds an active license
    And no instance license key is set
    When a user opens the sign-in page
    Then the identity provider button is not shown
    And the email and password form is offered

  @unimplemented
  Scenario: SSO sign-in routes are refused while the deployment is unlicensed
    Given a self-hosted deployment configured with an enterprise IdP
    And no organization holds an active license
    When a request is made directly to an SSO sign-in or callback route
    Then the request is refused
    And this holds for the legacy provider callback paths as well

  @unimplemented
  Scenario: An expiring license turns SSO off within the cache window
    Given a self-hosted deployment whose only license is about to expire
    When the license expires
    Then SSO becomes unavailable within the cache window
    And the sign-in page falls back to the email and password form

  # ============================================================================
  # Recovery — the no-lockout guarantee (PR-3)
  # ============================================================================

  @unimplemented
  Scenario: An SSO-only deployment recovers by setting the instance license key
    Given a self-hosted deployment where every user signs in only through SSO
    And the deployment has become unlicensed
    When the operator sets a valid instance license key and restarts
    Then SSO becomes available again
    And no password and no outbound email were required to recover

  @unimplemented
  Scenario: A fresh unlicensed deployment bootstraps via email then activates SSO live
    Given a fresh self-hosted deployment with no license
    When an operator signs up with email and password
    And activates an organization license in settings
    Then SSO becomes available without restarting the server

  # ============================================================================
  # Fail-closed and anti-takeover (PR-3)
  # ============================================================================

  @unimplemented
  Scenario: A licensing-store outage opens neither SSO nor password login
    Given a self-hosted deployment configured with an enterprise IdP
    And the licensing store cannot be reached
    When a user attempts to sign in
    Then SSO sign-in is refused
    And email and password sign-in is also refused

  @unimplemented
  Scenario: No password can be set on an account that only has SSO
    Given a deployment configured with an enterprise IdP
    And an existing user who has only an SSO credential
    When anyone attempts to set or reset a password for that user's email
    Then the attempt is refused
    And this holds whether the deployment is currently licensed or not

  @unimplemented
  Scenario: Existing sessions keep working across a gate change
    Given a signed-in user on a deployment that becomes unlicensed
    Then their existing session continues to work
    And only new sign-in attempts are subject to the gate

  # ============================================================================
  # SaaS (PR-3 / PR-4)
  # ============================================================================

  @unimplemented
  Scenario: SaaS always offers SSO at the platform level
    Given the deployment is LangWatch Cloud
    When a user opens the sign-in page
    Then SSO is available regardless of any single organization's plan

  @unimplemented
  Scenario: On SaaS, only paying organizations get per-organization SSO
    Given the deployment is LangWatch Cloud
    And organization "org-paid" is on a paid plan
    And organization "org-free" is on a free plan
    When domain auto-join is evaluated for each
    Then "org-paid" auto-joins matching users through SSO
    And "org-free" does not, and its users proceed to regular sign-up

  # ============================================================================
  # Per-organization domain SSO (PR-4)
  # ============================================================================

  @unimplemented
  Scenario: Unentitled organization's domain auto-join falls through to regular sign-up
    Given a self-hosted deployment with an active license held by another organization
    And organization "org-unlicensed" has a configured SSO domain but no entitlement
    When a user with that domain signs up
    Then they are not auto-joined to "org-unlicensed"
    And they proceed through regular sign-up without an error

  @unimplemented
  Scenario: Admins cannot configure SSO for an unentitled organization
    Given an operator editing organization settings in the backoffice
    And the target organization is not entitled to SSO
    When they attempt to set its SSO domain or provider
    Then the write is refused

  # ============================================================================
  # Telemetry (PR-2)
  # ============================================================================

  @unimplemented
  Scenario: Denied SSO attempts are recorded for abuse detection and sales signal
    Given a deployment that is not entitled to SSO
    When an SSO attempt is denied
    Then the denial is logged with its surface and reason
    And a denial analytics event is emitted with no personal data beyond identifiers
