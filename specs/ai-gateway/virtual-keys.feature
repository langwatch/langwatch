Feature: AI Gateway — Virtual Keys
  As a LangWatch user with gateway permissions
  I want to mint, configure, and rotate virtual API keys
  So that I can give downstream clients (SDKs, coding CLIs, production apps) a single
  credential that routes through the LangWatch AI Gateway to any configured provider

  A virtual key (VK) is a LangWatch-issued credential (format `lw_vk_{live|test}_<26-char-ulid>`,
  40 chars total — see specs/ai-gateway/_shared/contract.md §2) that the Gateway service resolves to:
  an owning project/team/org, a principal for attribution, a set of provider credentials with a
  fallback chain, model aliases, cache policy, guardrail policy, blocked patterns, and budgets.
  The secret half is displayed exactly once at creation and stored argon2id-hashed.

  Background:
    Given I am logged in
    And I am a member of organization "acme"
    And organization "acme" has team "platform" with project "gateway-demo"
    And project "gateway-demo" has "openai" and "anthropic" providers configured
    And I have "virtualKeys:manage" permission on project "gateway-demo"

  # ============================================================================
  # VK creation — secret show-once, format, default config
  # ============================================================================

  @integration
  Scenario: Create a virtual key with default config
    When I open the "AI Gateway" section
    And I click "New virtual key"
    And I enter "demo-key" as the key name
    And I select providers "openai" and "anthropic"
    And I click "Create"
    Then a new virtual key is created
    And the full secret is displayed exactly once with format "lw_vk_{live|test}_<26-char Crockford-base32 ULID>"
    And a "Copy" button is shown
    And a "I've saved it, close" confirmation is required before dismiss
    And after dismissal the full secret can never be retrieved again
    And only the key prefix "lw_vk_live_xxxx…" is visible in the list

  @integration
  Scenario: Virtual key secret is stored hashed
    Given I created a virtual key "demo-key" with secret "lw_vk_live_01HZX9K3M…"
    When the database row for "demo-key" is inspected
    Then the "hashedSecret" column contains an argon2id hash, not the raw secret
    And the "secretPrefix" column contains only the first 12 characters

  @visual
  Scenario: Virtual key list shows prefix, status, last-used, provider chain
    Given I have virtual keys "prod-key" (active) and "stale-key" (revoked)
    When I open the virtual keys list
    Then each row shows: name, prefix, status badge, last-used timestamp,
      fallback chain summary, budget status summary

  # ============================================================================
  # Provider credential wiring — reuses existing ModelProvider rows
  # ============================================================================

  @integration
  Scenario: Virtual key references existing project ModelProvider credentials
    Given project "gateway-demo" has ModelProvider "openai" with key "sk-existing"
    When I create virtual key "demo-key" and select "openai"
    Then the virtual key is linked to the existing "openai" ModelProvider row
    And no duplicate credential is created
    And updating the ModelProvider's API key reflects for the virtual key on next
      gateway cache refresh

  @integration
  Scenario: Virtual key cannot select a provider not configured on its project
    Given project "gateway-demo" does not have "bedrock" configured
    When I open the "new virtual key" drawer
    Then "bedrock" is disabled in the providers select with a hint to configure it first

  # ============================================================================
  # Fallback chain configuration
  # ============================================================================

  @integration
  Scenario: Ordered fallback chain is persisted and retrieved
    Given I am editing virtual key "prod-key"
    When I set the fallback chain to ["anthropic", "openai", "azure"]
    And I click "Save"
    Then the virtual key config returns fallback_chain in that order
    And the gateway config endpoint returns matching provider_credentials_ref ordering

  @integration
  Scenario: Fallback trigger conditions are configurable per VK
    Given I am editing virtual key "prod-key"
    When I enable fallback on "5xx", "429", and "timeout"
    And I set timeout_ms to 30000
    And I set max_attempts to 3
    Then the virtual key config persists these triggers
    And the resolved config payload contains
      { on: ["5xx","429","timeout"], timeout_ms: 30000, max_attempts: 3 }

  # ============================================================================
  # Model aliases
  # ============================================================================

  @integration
  Scenario: Alias overrides provider-prefixed model
    Given I am editing virtual key "prod-key"
    When I add model alias "fast" => "openai/gpt-5-mini"
    And I click "Save"
    Then a request to the gateway with model "fast" is routed to openai/gpt-5-mini
    And a request with explicit "anthropic/claude-haiku" is routed as-is (not aliased)

  # ============================================================================
  # Rotation, revocation, restore
  # ============================================================================

  @integration
  Scenario: Rotate virtual key issues a new secret and invalidates the previous one
    Given virtual key "prod-key" has secret "lw_vk_live_01HZX9K3MA…"
    When I click "Rotate secret" on "prod-key"
    And I confirm the rotation
    Then a new secret "lw_vk_live_01HZX9K3MB…" is generated and shown once
    And the previous secret no longer authenticates at the gateway after a max 60s cache window
    And an audit log entry "virtualKey.rotated" is recorded

  @integration
  Scenario: Revoke virtual key disables authentication immediately
    Given virtual key "prod-key" is active
    When I click "Revoke" and confirm
    Then the virtual key status is "revoked"
    And the gateway returns error type "virtual_key_revoked" (401)
    And the change propagates within the configured auth-cache TTL (default 60s)

  @integration
  Scenario: Revoked virtual key cannot be restored (must mint new)
    Given virtual key "prod-key" is revoked
    When I look at its row in the list
    Then I see no "Restore" action
    And only "Archive" and "Delete" are available

  # ============================================================================
  # Environment scoping (live vs test)
  # ============================================================================

  @integration
  Scenario: Test-scoped keys cannot call live providers if live-only flag is set
    Given project "gateway-demo" has providers set to "live-only" mode
    When I create virtual key "scratch" with environment "test"
    Then a call to the gateway authenticating with "scratch" returns "virtual_key_environment_mismatch"
    And the error is returned without a provider call

  # ============================================================================
  # Permissions (RBAC)
  # ============================================================================

  @integration
  Scenario: Viewer cannot create virtual keys
    Given I am a Viewer on project "gateway-demo"
    When I open the "AI Gateway" section
    Then the "New virtual key" button is disabled
    And the API rejects virtual key creation with "forbidden"

  @integration
  Scenario: Member with virtualKeys:create can create but not delete
    Given I have "virtualKeys:create" but not "virtualKeys:delete"
    When I open an existing virtual key
    Then I see "Edit", "Rotate", and "Revoke" actions
    And I do not see a "Delete" action

  # ============================================================================
  # Audit and attribution
  # ============================================================================

  @integration
  Scenario: Every VK mutation writes an audit log entry
    When I create, rotate, edit, or revoke a virtual key
    Then an audit log row is written with actor, action, target vk_id,
      before and after config snapshots, and timestamp

  @integration
  Scenario: Request attribution includes VK principal on every trace
    Given I have virtual key "prod-key" owned by user "alice@acme"
    When a request hits the gateway with "prod-key"
    Then the resulting trace has attribute "langwatch.virtual_key.id" = vk_id
    And attribute "langwatch.principal.id" = alice's user id

  # ============================================================================
  # Internal gateway endpoints (contract tests)
  # ============================================================================

  @integration
  Scenario: POST /internal/gateway/resolve-key returns tiny JWT
    Given virtual key "prod-key" exists
    When the gateway calls "POST /internal/gateway/resolve-key" with the raw secret
    Then the response contains a signed JWT with claims
      { vk_id, project_id, team_id, org_id, principal_id, revision, exp }
    And no provider credentials, no budget totals, no guardrail policies are in the JWT

  @integration
  Scenario: GET /internal/gateway/config/:vk_id returns full config
    Given the gateway has verified a JWT for vk_id "vk_123"
    When the gateway calls "GET /internal/gateway/config/vk_123" with "If-None-Match: 42"
    And the current revision is 42
    Then the response is 304 Not Modified
    When the gateway calls the same endpoint with "If-None-Match: 41"
    Then the response is 200 with the full config payload
    And the payload includes providers, fallback_chain, model_aliases, cache,
      guardrails, blocked_patterns, budgets, rate_limits, and a new revision

  @integration
  Scenario: GET /internal/gateway/changes?since=N long-polls for mutations
    Given the gateway has seen revision 100
    When the gateway calls "GET /internal/gateway/changes?since=100&timeout=25"
    And no change occurs within 25 seconds
    Then the response is 204 No Content with header "X-LangWatch-Revision: 100"
    When a user rotates a virtual key while the long-poll is open
    Then the endpoint returns 200 with a change event and the new revision
