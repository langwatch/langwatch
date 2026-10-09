# A stand-in OpenID Connect provider for tests that sign somebody in through single sign-on. It
# runs in the test process, on a loopback port or behind an injected fetch, and answers the way a
# real provider does: a discovery document, a key set, an authorization redirect carrying a code,
# and a token endpoint that trades that code once for an ID token signed with a key generated per
# run. Nothing is committed that could sign for a real provider.

Feature: The OIDC test provider answers a sign-in the way a real provider does
  As a developer proving a single sign-on callback end to end
  I want an in-process OpenID Connect provider with real signatures and real refusals
  So that a sign-in test exercises the deployment's verification rather than a mock of it

  @unit
  Scenario: The provider publishes where its endpoints are and which key signs
    Given an OIDC test provider for a client
    When its discovery document and key set are read
    Then the document names the issuer, the authorization, token, userinfo and key set endpoints
    And the key set holds the RS256 public key its ID tokens are signed with

  @unit
  Scenario: A code from the authorization redirect is traded for a signed ID token
    Given an OIDC test provider signing in a configured subject
    When the browser is sent to its authorization endpoint with a state, a nonce and a PKCE challenge
    Then it is redirected back to the redirect URL with a code and the same state
    And the code, its verifier and the client's credentials are traded for an ID token
    And the ID token verifies against the published key and names the issuer, the client, the nonce and the subject's claims
    And the userinfo endpoint answers the same subject for the access token

  @unit
  Scenario: The token endpoint refuses what a real provider refuses
    Given an OIDC test provider that has issued a code
    When the code is traded with the wrong client secret, the wrong verifier or the wrong redirect URL
    Then each trade is refused with the OAuth error code a real provider answers
    And a code already traded is refused as invalid_grant

  @unit
  Scenario: The provider is reachable over a loopback port
    Given an OIDC test provider started on a loopback port
    When its discovery document is fetched over the network
    Then it answers with the issuer on that port
    And stopping the provider closes the port
