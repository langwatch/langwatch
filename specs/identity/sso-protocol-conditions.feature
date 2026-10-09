Feature: Single sign-on believes an assertion or ID token only inside its own conditions

  # A signed SAML assertion or OpenID Connect ID token carries the conditions
  # it is valid under: a time window, the service it is for, the address it is
  # delivered to, the request it answers. Here the engine refuses one outside
  # them before any identity policy runs, so no user, account or session is
  # written. IdP-initiated responses: specs/identity/sso-saml-idp-initiated.feature.
  #
  # Already bound elsewhere, referenced rather than restated:
  # - SAML signed by an unrelated key or altered after signing:
  #   "A different or tampered signing certificate authenticates nothing"
  #   (specs/identity/sso-idp-termination.feature)
  # - OpenID Connect ID token unsigned, wrongly signed, for another audience,
  #   from another issuer or with another nonce:
  #   "Invalid Auth0 proof never reaches account or session creation"
  #   (specs/identity/mfa-and-session-shape.feature)

  Background:
    Given a single sign-on connection whose identity provider signs with a known key

  Rule: A SAML assertion is believed only within 120 seconds of the validity window its identity provider wrote

    @integration
    Scenario Outline: A SAML assertion whose <boundary> is <gap> <side> our clock is <outcome>
      Given a signed assertion whose <boundary> is <gap> <side> our clock
      When it is posted to the assertion consumer address
      Then the assertion is <outcome>

      Examples:
        | boundary     | gap         | side     | outcome  |
        | NotBefore    | 90 seconds  | ahead of | admitted |
        | NotBefore    | 180 seconds | ahead of | refused  |
        | NotOnOrAfter | 90 seconds  | behind   | admitted |
        | NotOnOrAfter | 180 seconds | behind   | refused  |

    @integration
    Scenario: An expired SAML assertion is refused before identity policy
      Given a signed assertion whose NotOnOrAfter passed five minutes ago
      When it is posted to the assertion consumer address
      Then the sign-in is refused as an invalid response
      And the connection's identity policy is never asked
      And no user, account or session is written

    @integration
    Scenario: A SAML assertion that is not yet valid is refused before identity policy
      Given a signed assertion whose NotBefore is nine minutes from now
      When it is posted to the assertion consumer address
      Then the sign-in is refused as an invalid response
      And the connection's identity policy is never asked
      And no user, account or session is written

  Rule: A SAML assertion is believed only by the service and at the address it names

    @integration
    Scenario: A SAML assertion for another service provider is refused
      Given a signed assertion whose audience is another service provider's entity id
      When it is posted to the assertion consumer address
      Then the sign-in is refused as an invalid response binding
      And no user, account or session is written

    @integration
    Scenario: A SAML assertion addressed to another recipient is refused
      Given a signed assertion whose recipient is another assertion consumer address
      When it is posted to the assertion consumer address
      Then the sign-in is refused as an invalid response binding
      And no user, account or session is written

    @integration
    Scenario: An unsigned SAML assertion is refused
      Given an assertion that carries no signature
      When it is posted to the assertion consumer address
      Then the sign-in is refused as an invalid response
      And the connection's identity policy is never asked
      And no user, account or session is written

  Rule: A SAML assertion is believed once

    @integration
    Scenario: Posting an admitted SAML response a second time is refused
      Given a service-provider-initiated sign-in that a signed assertion has already admitted
      When the same response is posted again
      Then the second post is refused as an answer to no open request
      And the sign-in still has exactly one session

    @integration
    Scenario: A used SAML assertion id answering a new sign-in is refused as a replay
      Given a service-provider-initiated sign-in that a signed assertion has already admitted
      When a new sign-in is answered by an assertion with the same assertion id
      Then the new sign-in is refused as a replay
      And the sign-in still has exactly one session

  Rule: An OpenID Connect ID token is believed only within 120 seconds of its validity window

    @integration
    Scenario Outline: An ID token from an identity provider whose clock is <offset> <direction> is <outcome>
      Given the identity provider's clock runs <offset> <direction> of ours
      When it answers a sign-in with an ID token that expires five minutes after it was issued
      Then the ID token is <outcome>

      Examples:
        | offset     | direction | outcome  |
        | 30 seconds | ahead     | admitted |
        | 4 minutes  | behind    | admitted |
        | 10 minutes | behind    | refused  |

    @integration
    Scenario: An expired ID token is refused before any account or session write
      Given an ID token whose expiry passed five minutes ago
      When the callback exchanges the code for it
      Then the sign-in is refused as unverifiable
      And no account or session is written

    @integration
    Scenario: An ID token not valid until later is refused before any account or session write
      Given an ID token whose not-before time is ten minutes from now
      When the callback exchanges the code for it
      Then the sign-in is refused as unverifiable
      And no account or session is written

    @integration
    Scenario: An ID token issued up to 120 seconds in the future is admitted
      Given an ID token whose issued-at time is one minute from now
      When the callback exchanges the code for it
      Then the sign-in succeeds

    @integration
    Scenario: An ID token issued in the future beyond the clock skew allowance is refused
      Given an ID token whose issued-at time is three minutes from now
      When the callback exchanges the code for it
      Then the sign-in is refused as unverifiable
      And no account or session is written

    @integration @unimplemented
    Scenario: An ID token that expired up to 120 seconds ago is admitted
      Given an ID token whose expiry passed one minute ago
      When the callback exchanges the code for it
      Then the sign-in succeeds

    @integration @unimplemented
    Scenario: An ID token whose not-before time is up to 120 seconds away is admitted
      Given an ID token whose not-before time is one minute from now
      When the callback exchanges the code for it
      Then the sign-in succeeds
