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
