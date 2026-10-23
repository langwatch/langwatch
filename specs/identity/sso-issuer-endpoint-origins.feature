Feature: An SSO connection reaches the endpoints its issuer's discovery document names
  The SSO engine reads the issuer's discovery document at sign-in and refuses
  any endpoint whose origin is not trusted. Google serves token, userinfo and
  keys from googleapis.com, and an AWS Cognito user pool serves authorize,
  token and userinfo from its hosted UI domain, so their connections were
  refused with `discovery_untrusted_origin`. For a sign-in request naming a
  registered issuer, the origins its discovery document names are trusted when
  they are https and resolve to public addresses.

  @integration @unit
  Scenario: Google's endpoints on googleapis.com are trusted for a Google connection
    Given an active connection with the issuer "https://accounts.google.com"
    When a user signs in through it
    Then the sign-in completes through the token, userinfo and keys endpoints on googleapis.com

  @unit
  Scenario: An AWS Cognito user pool's hosted UI domain is trusted for its connection
    Given an active connection with the issuer "https://cognito-idp.eu-central-1.amazonaws.com/<pool id>"
    When a sign-in request names that issuer
    Then the hosted UI domain that serves authorize, token and userinfo is trusted
    And so is the issuer's own origin, which serves the keys

  @unit
  Scenario: An endpoint origin that is not public https is not trusted
    Given a registered issuer whose discovery document names an http endpoint and one resolving to a private address
    When a sign-in request names that issuer
    Then neither origin is trusted

  @unit
  Scenario: Issuer discovery leaves through the deployment's outbound proxy
    Given the deployment reaches the internet only through an outbound proxy
    When an administrator saves an OpenID Connect connection
    Then the issuer's discovery document is read through the proxy
    And the issuer's address is still judged public before the request is sent

  @unit
  Scenario: An issuer origin an operator vouched for is reached directly, not through the proxy
    Given the deployment has an outbound proxy configured
    And SSO_TRUSTED_IDP_ORIGINS names an issuer origin inside the network
    And NO_PROXY does not name it
    When an administrator saves a connection with that issuer
    Then the discovery document is read directly from the vouched origin
    And a redirect out of that origin is judged again and travels through the proxy

  @unit
  Scenario: NO_PROXY does not lift the public-address check on discovery
    Given NO_PROXY names an issuer's host
    And that host resolves to a private address the operator has not trusted
    When an administrator saves a connection with that issuer
    Then discovery is refused, and nothing is fetched directly or through the proxy

  # Sign-in goes through better-auth's use of Node's global fetch, which the
  # egress fence does not carry yet (ADR-187).
  @integration @unimplemented
  Scenario: Sign-in reaches the identity provider through the deployment's outbound proxy
    Given the deployment reaches the internet only through an outbound proxy
    And an active OpenID Connect connection to a public identity provider
    When a user signs in through it
    Then the token exchange and the signing keys are fetched through the proxy
    And the sign-in completes
