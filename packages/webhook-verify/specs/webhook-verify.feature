Feature: Verifying a LangWatch webhook signature in the receiver
  A receiver verifies each delivery with @langwatch/webhook-verify before trusting it. Endpoints
  sign versioned per endpoint (Alex, 2026-10-06; ADR-167): t=,v1= for every registered endpoint,
  and the legacy sha256= for destinations that signed that way on main.

  @unit
  Scenario: The verifier agrees with every published signature vector
    Given the signing and verification vectors the webhook module generates
    When each vector is verified with its secrets, clock and tolerance
    Then every valid vector passes
    And every other vector is refused with the vector's failure code

  @unit
  Scenario: A legacy sha256 signature verifies only when the receiver asks for that scheme
    Given a body signed as sha256=<hex> over the raw body
    When the receiver verifies it with the sha256 scheme
    Then it passes
    And verifying it with the default v1 scheme is refused as malformed_header

  @unit
  Scenario: The Hono middleware refuses an unsigned delivery and passes a signed one
    Given a Hono-style route guarded by the webhook middleware
    When a delivery arrives with a valid signature, and another with a wrong one
    Then the valid one reaches the handler with its body still readable
    And the wrong one is answered 401 with invalid_signature

  @unit
  Scenario: The Express middleware refuses an unsigned delivery and passes a signed one
    Given an Express-style route guarded by the webhook middleware after express.raw()
    When a delivery arrives with a valid signature, and another with a wrong one
    Then the valid one reaches the next handler
    And the wrong one is answered 401 with invalid_signature
