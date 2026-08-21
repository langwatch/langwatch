# The claims runner lives in packages/authz (credential-claims.ts); the
# surfaces that arbitrate through it are the dual-auth byte endpoints
# (platform/app/src/app/api/middleware/dual-auth.ts) and the API-key
# permission gate (server/api-key/auth-middleware.ts). Approach follows
# mojo's authenforce exactly-one-claims model: every credential kind that
# is in play claims the request, and anything other than exactly one claim
# is a refusal — never a guess.

@authz
Feature: Credential arbitration
  As the LangWatch platform
  I want exactly one credential to decide who a request is
  So that no request is answered by guessing between identities, and no
  permission gate silently waves through a request nobody authenticated

  # ═══ The claims runner (packages/authz) ═══════════════════════════════

  @unit
  Scenario: A single claim wins the arbitration
    Given one credential kind claims a request
    When the claims are arbitrated
    Then that claim is chosen
    And the caller is told which kind won

  @unit
  Scenario: No claims is structurally unauthenticated
    Given no credential kind claims a request
    When the claims are arbitrated
    Then the outcome is unclaimed
    And no credential kind is chosen

  @unit
  Scenario: Competing claims are contested, never ranked
    Given two credential kinds both claim a request
    When the claims are arbitrated
    Then the outcome is contested
    And the refusal names every claiming kind
    And no precedence rule picks a winner

  # ═══ Dual-auth byte endpoints (files, avatars) ════════════════════════
  # These endpoints previously tried the API key first and fell back to
  # the session cookie on 401/403. Arbitration replaces that precedence:
  # a fallback that swallows a credential failure is a guess about which
  # identity the caller meant.

  @unit
  Scenario: An API key alone authenticates a byte endpoint
    Given a request carrying API key credentials and no session
    When the request is arbitrated
    Then the API key authenticates it

  @unit
  Scenario: A session alone authenticates a byte endpoint
    Given a browser request carrying a live session and no API key headers
    When the request is arbitrated
    Then the session authenticates it

  @unit
  Scenario: A request carrying both credential kinds is refused
    Given a request carrying API key credentials and a live session
    When the request is arbitrated
    Then it is refused as contested
    And the refusal tells the caller to send exactly one credential

  @unit
  Scenario: A non-LangWatch proxy credential abstains so the session decides
    Given a browser request whose Authorization header a reverse proxy set to
      a credential that is not a LangWatch token
    And the same request carries a live session
    When the request is arbitrated
    Then the proxy credential does not claim the request
    And the session authenticates it rather than the two contesting

  @unit
  Scenario: An invalid API key is refused without falling back to the session
    Given a request whose API key credentials do not resolve
    When the request is arbitrated
    Then the API key's own refusal is the answer
    And no other credential kind is tried in its place

  @unit
  Scenario: A request with neither credential is refused
    Given a request with no API key headers and no session
    When the request is arbitrated
    Then it is refused as unauthenticated

  # ═══ The API-key permission gate fails closed ═════════════════════════

  @unit
  Scenario: The permission gate refuses a request nobody authenticated
    Given a permission gate mounted without the unified auth middleware
    When a request reaches it with no resolved credential
    Then the request is refused, not passed through
    And the failure is reported as the platform's own misconfiguration
