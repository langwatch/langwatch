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
  Scenario: A legacy prefix-less project key with no session still authenticates
    Given a request carrying a project key minted before LangWatch key prefixes
    And the request carries no session
    When the request is arbitrated
    Then the key claims the request
    And the stored-key lookup decides whether it authenticates

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

  # ═══ The project a credential names ═══════════════════════════════════
  #
  # A scoped API key can carry bindings at several projects, and an
  # organization-scoped key carries none at any single one, so the project a
  # request acts on cannot always be inferred from the key alone. X-Project-Id
  # is how a caller pins it (specs/security/api-endpoint-authorization.feature).
  #
  # The header therefore names the project; it must never WIDEN the key. The
  # only guard used to be "same organization", so a key bound to one project
  # could name any sibling and authenticate as it. On a route that gates a
  # permission the ceiling caught it, but a route that only authenticates
  # handed the handler a project the key was never granted.

  @unit
  Scenario: A key naming a project it holds no binding for is refused
    Given a scoped API key bound to one project
    When it names a different project of the same organization in X-Project-Id
    Then the credential does not resolve to that project
    And the refusal is reported as insufficient permission, not bad credentials

  @unit
  Scenario: A key naming a project of another organization is refused
    Given a scoped API key
    When it names a project outside its own organization in X-Project-Id
    Then the credential does not resolve
    # Unchanged: existence of another tenant's project is not the caller's to
    # learn, so this stays the generic refusal rather than a permission denial.

  @unit
  Scenario: An organization-scoped key reaches any project it covers
    Given an API key bound at organization scope
    When it names a project of that organization in X-Project-Id
    Then the credential resolves to that project
    # The ancestor walk is the engine's, not a second implementation: an
    # organization or team binding covers the projects beneath it.

  @unit
  Scenario: A key bound to exactly one project needs no header
    Given a scoped API key bound to a single project
    When it sends no X-Project-Id
    Then the credential resolves to that project

  @unit
  Scenario: A key covering several projects is told to name one
    Given a scoped API key bound to two projects
    When it sends no X-Project-Id
    Then the refusal says the request must name a project
    And it is not reported as invalid credentials
    # The key is valid and the caller can act on the answer, so "invalid
    # credentials" sent people to check a secret that was never the problem.

  @unit
  Scenario: An empty project header is a caller error, not a server fault
    Given a scoped API key
    When it sends X-Project-Id as an empty string
    Then the request is refused as a caller error
    And no internal fault is logged
    # An SDK serializes the header whenever its project variable is set but
    # blank; the contract's own validation rejected it as a thrown fault and
    # the boundary answered 500 with a database-error log line.
