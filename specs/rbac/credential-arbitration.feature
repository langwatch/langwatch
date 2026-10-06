# /api/files and /api/user-avatar are API-key routes (ARCHITECTURE.md §8,
# Alex 2026-09-30, restated 2026-10-06); the UI reads media through a
# tRPC-minted URL. No request is arbitrated between a session and a key.

@authz
Feature: Credential arbitration
  As the LangWatch platform
  I want a byte route to be decided by its API key alone
  So that no request is answered by guessing between identities, and no
  permission gate silently waves through a request nobody authenticated

  # ═══ Byte endpoints (files, avatars) are key-only ═════════════════════

  @unit
  Scenario: An API key alone authenticates a byte endpoint
    Given a request carrying API key credentials and no session
    When it reaches the key door
    Then the key's project decides the read

  @unit
  Scenario: A byte endpoint does not accept a session in place of a key
    Given a browser request with a live session and no API key
    When it asks /api/files
    Then it is refused as unauthenticated
    And the session is never consulted

  @unit
  Scenario: A legacy prefix-less project key with no session still authenticates
    Given a request carrying a project key minted before LangWatch key prefixes
    And the request carries no session
    When it reaches the key door
    Then the stored-key lookup decides whether it authenticates

  @unit
  Scenario: An invalid API key is refused without falling back to the session
    Given a request whose API key credentials do not resolve
    When it reaches the key door
    Then the API key's own refusal is the answer
    And no other credential kind is tried in its place

  @unit
  Scenario: A request with neither credential is refused
    Given a request with no API key headers and no session
    When it reaches the key door
    Then it is refused as unauthenticated

  @integration
  Scenario: The browser reads stored media through a URL tRPC minted
    Given a signed-in browser session
    When the UI asks tRPC for a stored object's URL
    Then the browser reads the media through that minted URL
    And the browser never sends its session to the byte route

  # ═══ The API-key permission gate fails closed ═════════════════════════

  @unit
  Scenario: A key route reached with no resolved credential is refused before its handler
    Given a permission gate mounted without the unified auth middleware
    When a request reaches it with no resolved credential
    Then the request is refused, not passed through
    And the failure is reported as the platform's own misconfiguration
