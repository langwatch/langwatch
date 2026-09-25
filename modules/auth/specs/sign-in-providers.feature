Feature: The deployment's sign-in providers mount on Better Auth

  The provider a deployment names (AUTH_PROVIDER, or the deprecated
  NEXTAUTH_PROVIDER) mounts on the one Better Auth instance when its client id,
  secret and, for an enterprise provider, its issuer are set, as on main.
  Enterprise SSO shapes the providers; auth asks it for them on first use.
  Outside email mode every social provider whose credentials are set mounts
  beside it (main's D09), and federation is offered only where a signed
  license permits platform single sign-on (ADR-027).

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
    And its accounts stay under their stored issuer and its ID token must verify

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

