Feature: A federated callback's session claims come only from verified evidence
  As a member who signs in through an enterprise identity provider
  I need the session minted for me to record exactly the account and factors the provider proved
  So that an organization's two-step requirement is satisfied by evidence, never by a stale or foreign claim

  # Moved from specs/identity/mfa-and-session-shape.feature: identity mints the
  # session claims, so the scenarios live with the module that owns the mint.

  @unit
  Scenario Outline: An enterprise callback records the exact accepted account
    Given "sam" has an identifier for "<provider>" subject "<subject>"
    And that provider requires cryptographic ID-token verification
    When its accepted callback carries subject "<subject>"
    Then the session records that exact identifier
    And an identifier for another provider or subject is not selected

    Examples:
      | provider | subject        |
      | auth0    | auth0\|sam     |
      | okta     | okta-user-sam |

  @unit
  Scenario: Current verified Auth0 factors are recorded on the new session
    Given Auth0 requires cryptographic ID-token verification
    When the accepted callback for "sam" asserts "pwd otp unknown"
    Then the new session records "oidc pwd otp"
    And the unsupported assertion is omitted

  # The identity provider can be down, or not yet resolvable, while the app
  # starts. That must cost single sign-on only, never the whole application.
  @integration
  Scenario: An unreachable identity provider at startup does not take the application down
    Given the deployment signs in through Okta, which requires verified ID tokens
    And Okta's discovery URL refuses connections while the application starts
    When the application initializes
    Then initialization completes with Okta not mounted
    And an error log names the provider and the discovery host
    And a sign-in through Okta is refused as an unknown provider
    And password sign-up still works

  @integration
  Scenario: Single sign-on comes back once the identity provider is reachable, still verifying ID tokens
    Given Okta was unreachable when the application started
    When Okta's discovery document becomes reachable
    Then Okta is mounted without a restart
    And its sign-in carries an ID-token nonce
    And a callback whose ID token the published keys did not sign writes no Account or Session

  @integration
  Scenario: An identity provider whose discovery cannot verify ID tokens is never mounted
    Given Okta's discovery document publishes an issuer but no signing key set
    When the application initializes
    Then initialization completes with Okta not mounted

  @unit
  Scenario: A valid signed Auth0 callback reaches account and session creation
    Given Auth0 discovery publishes the issuer, audience and signing key
    When Auth0 returns a correctly signed token with the callback nonce
    Then BetterAuth accepts the callback and writes its Account and Session

  @unit
  Scenario Outline: Invalid Auth0 proof never reaches account or session creation
    Given Auth0 requires cryptographic ID-token verification
    When its callback token carries <invalid proof>
    Then BetterAuth refuses the callback before writing an Account or Session

    Examples:
      | invalid proof        |
      | an unknown signature |
      | the wrong issuer     |
      | the wrong audience   |
      | the wrong nonce      |

  @unit
  Scenario Outline: Invalid callback state reaches no account or session write
    Given an Auth0 sign-in has issued callback state
    When the callback state is <state defect>
    Then BetterAuth refuses the callback before writing an Account or Session

    Examples:
      | state defect                    |
      | missing                         |
      | different from the issued state |

  @unit
  Scenario: Replaying an accepted callback creates no additional account or session
    Given a valid Auth0 callback has created one Account and Session
    When the browser applies the callback response cookies and replays the same callback
    Then BetterAuth refuses the replay
    And no additional Account or Session is written

  @unit
  Scenario: A stored MFA assertion cannot speak for a later callback
    Given an older Auth0 token for "sam" asserted "pwd otp"
    And the current accepted Auth0 callback carries no ID token
    When that callback mints a session
    Then the session is attributed to the accepted Auth0 account
    But the session records no authentication methods

  @unit
  Scenario: Simultaneous provider callbacks cannot exchange evidence
    Given an Auth0 callback for "sam" and an Okta callback for another subject overlap
    When both accepted account writes complete
    Then each request keeps its own provider subject
    And neither request carries authentication methods from the other

  @unit
  Scenario Outline: Unbound token claims earn no authentication credit
    Given a callback token asserts the factor "otp"
    When <unsafe evidence>
    Then the token contributes no authentication methods
    And identifier attribution comes only from the accepted callback account

    Examples:
      | unsafe evidence                                               |
      | the callback provider does not guarantee token verification  |
      | the claims are requested for a different callback provider    |
      | the token subject differs from the accepted provider account  |
      | the token merely appears on a non-callback request             |
