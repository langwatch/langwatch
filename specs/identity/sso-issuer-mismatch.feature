Feature: An SSO connection's issuer matches the issuer its ID tokens carry
  The SSO engine compares an ID token's `iss` claim to the connection's stored
  issuer character for character. Microsoft Entra ID v2 tokens carry
  `https://login.microsoftonline.com/<tenant id>/v2.0` with no trailing slash,
  so an issuer stored with one refused every sign-in with a generic
  `token_not_verified`. The stored issuer is the one the provider's discovery
  document names, Entra ID issuers are kept in their canonical form, and a
  token from another issuer is refused with a named error that quotes both.

  Background:
    Given a self-hosted installation with an OpenID Connect connection

  @integration @unit
  Scenario: A Microsoft Entra ID connection stored with a trailing slash signs in after the upgrade
    Given the connection's issuer was stored as "https://login.microsoftonline.com/<tenant id>/v2.0/"
    When the upgrade runs
    Then a guest whose token names "https://login.microsoftonline.com/<tenant id>/v2.0" signs in
    And the connection was not registered again

  @integration @unit
  Scenario: An ID token from another issuer is refused with both issuers named
    Given the connection is registered for the app's tenant
    When a guest signs in with a token naming their home tenant's issuer
    Then the sign-in is refused with "sso_issuer_mismatch"
    And the page names the issuer the connection expects and the issuer the token carried

  @unit
  Scenario: Registration stores the issuer the discovery document names
    When an administrator registers "https://login.microsoftonline.com/<tenant id>/v2.0/"
    Then the connection stores "https://login.microsoftonline.com/<tenant id>/v2.0"

  @unit
  Scenario: Registration refuses a Microsoft Entra ID multi-tenant issuer
    When an administrator registers "https://login.microsoftonline.com/common/v2.0"
    Then the registration is refused with "sso_issuer_multi_tenant"

  @unit
  Scenario: Registration refuses a discovery document that names another issuer
    When an administrator registers an issuer whose discovery document names a different one
    Then the registration is refused with "sso_issuer_mismatch" naming both issuers
