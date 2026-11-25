Feature: The deployment's sign-in providers mount on Better Auth

  The provider a deployment names (AUTH_PROVIDER, or the deprecated
  NEXTAUTH_PROVIDER) mounts on the one Better Auth instance when its client id,
  secret and, for an enterprise provider, its issuer are set, as on main.
  Enterprise SSO shapes the providers; auth asks it for them on first use.
  Outside email mode every social provider whose credentials are set mounts
  beside it (main's D09), and federation is offered only where a signed
  license permits platform single sign-on (ADR-027).

  Mounting is not offering. On cloud, Auth0 stays mounted so organizations
  still on legacy Auth0 SSO reach it by domain routing, but the sign-in screen
  and the Connect buttons never offer it (specs/identity/signin-router.feature,
  "Cloud never offers the Auth0 broker on the sign-in screen").

  @unit
  Scenario: A deployment that names no provider mounts none
    Given no sign-in provider is named
    When enterprise SSO shapes the providers Better Auth mounts
    Then no social provider and no enterprise provider is mounted

  @unit
  Scenario: A named provider with its credentials mounts on Better Auth
    Given AUTH_PROVIDER is "auth0" with its client id, secret and issuer set
    When enterprise SSO shapes the providers Better Auth mounts
    Then auth0 is mounted on the callback path customers registered
    And its ID token must verify

  @unit
  Scenario: A named provider without its secret mounts nothing
    Given AUTH_PROVIDER is "google" with a client id but no client secret
    When enterprise SSO shapes the providers Better Auth mounts
    Then no provider is mounted

  @unit
  Scenario: Every social provider with credentials mounts outside email mode
    Given AUTH_PROVIDER is "auth0" with its registration set
    And google and github client ids and secrets are set too
    When enterprise SSO shapes the providers Better Auth mounts
    Then google, github and auth0 are all mounted

  @unit
  Scenario: A social provider reaches the real host unless a base is set
    Given google and github are mounted and no sign-in base is set
    When Better Auth builds the google and github sign-in links
    Then both links point at the real provider

  @unit
  Scenario: A social provider reaches the base a deployment names
    Given google and github are mounted and a sign-in base is set for each
    When Better Auth builds a sign-in link and exchanges the code
    Then the link and the token, user and email calls all go to that base
    And gitlab and microsoft take their base as issuer and authority

  @unit
  Scenario: Email mode mounts no social provider whatever credentials linger
    Given AUTH_PROVIDER is "email"
    And a google client id and secret are set
    When enterprise SSO shapes the providers Better Auth mounts
    Then no provider is mounted

  @unit
  Scenario: Better Auth asks enterprise SSO for its providers on first use, not while composing
    Given a deployment that named its browser-session identity
    When the auth module is constructed
    Then enterprise SSO has not been asked for the sign-in providers
    And the first callers to reach Better Auth share one request, made under Better Auth's own URL

  @unit
  Scenario: A licensed self-hosted install reports federation licensed
    Given a self-hosted install that names auth0 and mounted it
    And a signed license permits platform single sign-on
    When the sign-in method policy is resolved
    Then federation is licensed and auth0 is offered

  @unit
  Scenario: An unlicensed install that names a provider signs in by email
    Given a self-hosted install that names auth0
    And no signed license permits platform single sign-on
    When the sign-in method policy is resolved
    Then federation is unlicensed and no federated method is offered

  @unit
  Scenario: A licensed install whose named provider did not mount signs in by email
    Given a licensed self-hosted install that names auth0
    And auth0 did not mount
    When the sign-in method policy is resolved
    Then no federated method is offered

  # Main's platformSSOAllowed lives on as enterprise SSO's gate (ADR-027); auth
  # keeps no second licence check beside it.
  @unit
  Scenario: Every sign-in decision asks enterprise SSO's licence gate
    Given a self-hosted install that names auth0 and mounted it
    When the sign-in method policy is resolved and the federation gate is asked
    Then each answer comes from enterprise SSO's gate
    And that gate's licence log lines, once-only email-mode warning and evaluation timeout apply to sign-in

  @unit
  Scenario: A gate that gave up on a silent licensing store leaves sign-in on email
    Given a self-hosted install that names auth0 and mounted it
    And enterprise SSO's gate refused because the licensing store did not answer in time
    When the sign-in method policy is resolved
    Then no federated method is offered


  @integration
  Scenario: The sign-in screen offers only the configured providers in every environment
    Given the deployment offers google and no other social provider
    When the sign-in screen renders in development
    Then google is offered
    And no other social provider is offered

  @regression @integration
  Scenario: Every provider mark on a sign-in button declares its own size
    Given the sign-in screen offers google, github and microsoft
    When their buttons render
    Then each provider mark is an svg with a width and height equal to its box
