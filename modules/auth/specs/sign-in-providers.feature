Feature: The deployment's sign-in providers mount on Better Auth

  The provider a deployment names (AUTH_PROVIDER, or the deprecated
  NEXTAUTH_PROVIDER) mounts on the one Better Auth instance when its client id,
  secret and, for an enterprise provider, its issuer are set, as on main.

  @unit
  Scenario: A deployment that names no provider mounts none
    Given no sign-in provider is named
    When the auth module composes Better Auth
    Then no social provider and no enterprise provider is mounted

  @unit
  Scenario: A named provider with its credentials mounts on Better Auth
    Given AUTH_PROVIDER is "auth0" with its client id, secret and issuer set
    When the auth module composes Better Auth
    Then auth0 is mounted on the callback path customers registered
    And its accounts stay under their stored issuer and its ID token must verify

  @unit
  Scenario: A named provider without its secret mounts nothing
    Given AUTH_PROVIDER is "google" with a client id but no client secret
    When the auth module composes Better Auth
    Then no provider is mounted
