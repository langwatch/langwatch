Feature: HTTP hosting for API and browser surfaces
  One HTTP host resolves client addresses and applies shared security policy.
  API routes remain inside the API boundary; browser documents share API sessions.

  @unit
  Scenario: The most specific route wins without rewriting the public URL
    Given API, tRPC and browser routes registered in any order
    When requests address each prefix or an unknown API path
    Then the most specific prefix handles the original URL
    And an unknown API path never reaches the browser bundle

  @unit
  Scenario: Preamble failures retain headers and surface-specific errors
    Given a failing middleware before the shared security policy
    When an API or browser request fails before routing
    Then the response retains the shared security headers
    And the selected surface presents the error

  @unit
  Scenario: Surface policies override headers and HEAD omits the body
    Given shared headers and a route with an explicit header override
    When a HEAD request reaches the route
    Then the override is preserved and the response has no body
    And the serving route table cannot be changed

  @unit
  Scenario: Untrusted forwarding headers cannot replace the socket address
    Given an HTTP listener that trusts no proxies
    When a connected caller sends a forged forwarding header
    Then the resolved client address is the actual socket address

  @unit
  Scenario: A trusted proxy resolves the first untrusted forwarded hop
    Given a configured trusted proxy range
    When a proxy forwards the caller through other trusted hops
    Then the shared address is the first untrusted hop from the right

  @unit
  Scenario: A named target retains its error presenter
    Given a class whose error presenter is a prototype getter
    When its request handler fails
    Then the host uses that presenter's response

  @unit
  Scenario: Security header policy is case insensitive
    Given strict security headers
    When a policy overrides or removes a header using different casing
    Then the header has one effective value or is removed
    And the original policy is unchanged

  @unit
  Scenario: Bundle documents share sessions while assets skip verification
    Given a built browser bundle and a session verifier
    When a document and hashed assets are requested
    Then the document verifies once and receives public config
    And assets use immutable caching without verifying a session
    And a missing asset returns 404

  @unit
  Scenario: A document access policy can redirect before rendering
    Given an anonymous caller and a protected document policy
    When the caller requests a document
    Then the policy redirects before public config is projected
    And the redirect retains security headers
    And static assets remain available
