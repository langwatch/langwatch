Feature: CLI device flow refusals keep the RFC 8628 wire
  Released `langwatch` CLI builds and the browser approval page parse the
  device flow's two-field refusal body, `{ error, error_description }`, at the
  status the flow names. Every refusal on the family keeps that body exactly.

  @integration
  Scenario: An unknown device code polled at exchange answers expired_token
    Given a device code that was never minted or has been evicted
    When the CLI polls "/api/auth/cli/exchange" with it
    Then it is answered 408 with error "expired_token" and "Device code expired or unknown"

  @integration
  Scenario: The approval page's lookup of an unknown code says it may have expired
    Given a signed-in person and a user code nobody minted
    When the approval page looks the code up
    Then it is answered 404 with error "not_found" and "Code not recognised — it may have expired"

  @integration
  Scenario: Approving an unknown code answers not_found
    Given a signed-in member and a user code nobody minted
    When they approve the code
    Then it is answered 404 with error "not_found" and "Code not recognised"

  @integration
  Scenario: Denying an unknown code is a no-op
    Given a signed-in person and a user code nobody minted
    When they deny the code
    Then it is answered 200 with ok true

  @integration
  Scenario: The browser half refuses a caller with no session in the RFC 8628 shape
    Given nobody is signed in
    When the lookup, the approval or the denial is called
    Then each is answered 401 with error "unauthorized" and "Sign in to continue"

  @integration
  Scenario: An unknown refresh token answers invalid_grant
    Given a refresh token that was never minted or has been revoked
    When the CLI rotates it
    Then it is answered 401 with error "invalid_grant" and "Refresh token is invalid or revoked"

  @integration
  Scenario: A failure the flow did not name still answers in the RFC 8628 shape
    Given the key registry fails unexpectedly while an approval validates its selection
    When the person approves the code
    Then it is answered 500 with error "server_error" and nothing more about the cause
