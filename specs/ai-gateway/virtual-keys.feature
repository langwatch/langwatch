Feature: AI Gateway — Virtual Keys

  # Seven scenarios below are bound to virtualKey.service /
  # virtualKey.crypto unit tests. The remaining @unimplemented scenarios
  # fall in three unbindable categories:
  # (1) UI flows (create drawer, edit drawer, list rendering, capability
  #     preview, audit-history button, usage section) — need
  #     component-test fixtures against the Gateway settings pages.
  # (2) End-to-end gateway-internal endpoint scenarios
  #     (POST /internal/gateway/resolve-key, GET /config/:vk_id,
  #     GET /changes?since=N) — implemented in the Go gateway service.
  # (3) Integration-level VK-config persistence (fallback chain,
  #     trigger conditions, model aliases, ModelProvider linkage) —
  #     could bind once a tRPC router integration test is added under
  #     langwatch/src/server/api/routers/__tests__/.
  # All aspirational pending those harnesses.

  As a LangWatch user with gateway permissions
  I want to mint, configure, and rotate virtual API keys
  So that I can give downstream clients (SDKs, coding CLIs, production apps) a single
  credential that routes through the LangWatch AI Gateway to any configured provider

  A virtual key (VK) is a LangWatch-issued credential (format `vk-lw-<26-char-ulid>`,
  32 chars total — see specs/ai-gateway/_shared/contract.md §2) that the Gateway
  service resolves to: an `organizationId` (mandatory tenant key), one-or-more
  `VirtualKeyScope` rows (ORGANIZATION / TEAM / PROJECT), an optional
  `principalUserId` (personal-VK marker, orthogonal to scope), a `RoutingPolicy`
  reference (or null → default-policy fallback per vk-config-bundle.feature),
  model aliases, models_allowed list, and the bundle of routable ModelProviders
  resolved live from the scope graph (see vk-scope-inheritance.feature).

  The secret half is displayed exactly once at creation and stored as a
  peppered HMAC-SHA256 hash (see contract.md §2 for why HMAC-SHA256 over argon2id:
  ULID body is already brute-force-infeasible at 130 bits, argon2id would add
  50-100ms per cold resolve-key and defeat the gateway's latency budget, and
  deterministic hash enables O(1) lookup by hash).

  Background:
    Given I am logged in
    And I am a member of organization "acme"
    And organization "acme" has team "platform" with project "gateway-demo"
    And ModelProviders "openai" and "anthropic" are scoped to TEAM "platform"
    And I have "virtualKeys:manage" at TEAM "platform"

  # ============================================================================
  # VK creation — secret show-once, format, default config
  # ============================================================================

  # End-to-end VK create lives in the dogfood matrix runs (PR-body Tier 1
  # cells under "F-matrix wave 2"). Pin as @unimplemented until a
  # VirtualKeyService.create integration backfill lands.
  @integration @unimplemented
  Scenario: Create a virtual key with default config
    When I open the "AI Gateway" section
    And I click "New virtual key"
    And I enter "demo-key" as the key name
    And I select providers "openai" and "anthropic"
    And I click "Create"
    Then a new virtual key is created
    And the full secret is displayed exactly once with format "vk-lw-<26-char Crockford-base32 ULID>"
    And a "Copy" button is shown
    And a "I've saved it, close" confirmation is required before dismiss
    And after dismissal the full secret can never be retrieved again
    And only the key prefix "vk-lw-xxxx…" is visible in the list

  # ============================================================================
  # Usage-snippet default model. The copy-paste example must name a model the
  # key can actually serve. A key bound to a self-hosted OpenAI-compatible
  # provider (vLLM, LiteLLM) that shows the OpenAI drop-in "gpt-5-mini" sends a
  # model the endpoint has never heard of, so the first copy-paste call 404s.
  # The gateway strips the provider prefix before dispatch, so the
  # "<provider>/<model>" form is always safe: it selects the provider, then
  # forwards the bare model name upstream.
  # ============================================================================

  @integration
  Scenario: Usage example defaults to a model the key can serve
    Given a virtual key scoped to a custom provider whose model is "Qwen2.5-0.5B-Instruct"
    When the secret-reveal dialog shows the usage example after create
    Then the example calls model "custom/Qwen2.5-0.5B-Instruct"
    And it does not fall back to "gpt-5-mini"

  @integration
  Scenario: Usage example on the key detail page matches the key's provider
    Given a virtual key scoped only to a custom provider whose model is "Qwen2.5-0.5B-Instruct"
    When I open the key detail page usage example
    Then the example calls model "custom/Qwen2.5-0.5B-Instruct"

  @integration
  Scenario: Usage example falls back to a safe placeholder when no provider is resolvable
    Given a virtual key whose eligible providers cannot be resolved on the client
    When the usage example renders
    Then the example calls model "gpt-5-mini" as a safe placeholder

  @integration
  Scenario: Virtual key secret is stored as peppered HMAC-SHA256 hash
    Given I created a virtual key "demo-key" with secret "vk-lw-01HZX9K3M…"
    When the database row for "demo-key" is inspected
    Then the "hashedSecret" column contains hex(hmac_sha256(LW_VIRTUAL_KEY_PEPPER, raw_secret))
    And it does NOT contain the raw secret
    And the "secretPrefix" column contains only the first 12 characters

  @visual
  Scenario: Virtual key list shows prefix, status, last-used, provider chain
    Given I have virtual keys "prod-key" (active) and "stale-key" (revoked)
    When I open the virtual keys list
    Then each row shows: name, prefix, status badge, last-used timestamp,
      fallback chain summary, budget status summary

  @visual
  Scenario: Virtual key list renders the fallback chain as stacked provider icons
    Given virtual key "prod-openai" has a provider chain [openai primary, anthropic fallback-1]
    When I open the virtual keys list
    Then the Providers column shows the OpenAI icon at full opacity
    And the Anthropic fallback icon at 60% opacity after a "→" separator
    And hovering the chain exposes a tooltip reading "openai → anthropic"

  @visual
  Scenario: Virtual key list Last-used column shows relative time
    Given virtual key "prod-openai" was last used 3 hours ago
    And virtual key "dev-sandbox-legacy" was never used
    When I open the virtual keys list
    Then the prod-openai row shows "about 3 hours ago" with the exact timestamp on hover
    And the dev-sandbox-legacy row shows "never" in muted text

  # ============================================================================
  # Create-drawer capability preview (Lane B iter 23) — minimum-viable
  # creation surface with a read-only preview of advanced settings.
  #
  # The create drawer only exposes name/description/environment/provider
  # chain; every other capability (cache control, guardrails, policy
  # rules, rate limits) is editable post-create via the edit drawer.
  # Showing defaults in the create drawer avoids doubling the surface
  # while still advertising what the gateway offers.
  # ============================================================================

  @integration @unimplemented
  Scenario: Create drawer shows capability preview with post-create defaults
    When I open the "New virtual key" drawer
    Then a "What else you get (configurable after create)" section is visible
    And it lists the following defaults:
      | capability        | default     |
      | Cache control     | respect     |
      | Guardrails        | none        |
      | Policy rules      | none        |
      | Rate limits       | unlimited   |
    And each row has a short description of the capability
    And no inputs are shown for these capabilities in the create drawer
    And the preview is labelled as a "preview" badge to signal read-only

  @integration @unimplemented
  Scenario: Capability preview cache-control default is provider-agnostic
    When I open the "New virtual key" drawer
    Then the "Cache control" preview row reads "respect" as the default
    And its description mentions provider-agnostic passthrough across
      Anthropic cache_control, OpenAI/Azure automatic caching, and Gemini
      cachedContent
    And the description does NOT frame caching as Anthropic-specific

  # ============================================================================
  # Cache control (Lane B iter 35) — provider-agnostic framing in the edit
  # drawer. Modes: respect (passthrough, default), force (always cache on
  # providers that support it, no-op where unsupported), disable (strip
  # cache hints so provider responses are never cached).
  # ============================================================================

  @integration @unimplemented
  Scenario: Edit drawer shows three cache-control modes with provider-agnostic helper
    Given I am editing virtual key "prod-key"
    When I expand the "Cache control" section
    Then three options are available: respect, force, disable
    And respect is selected by default
    And the helper copy describes behaviour for Anthropic (cache_control),
      OpenAI/Azure (automatic), and Gemini (cachedContent) without
      anchoring the feature to any single provider

  @integration @unimplemented
  Scenario: Force cache mode is documented as no-op on providers that do not honour it
    Given I am editing virtual key "prod-key"
    When I select cache mode "force"
    Then the save is accepted for all selected providers
    And the helper copy warns that providers without explicit cache
      controls (e.g. Gemini's side-effect model) treat force as a best-effort hint

  # ============================================================================
  # Provider credential wiring — reuses existing ModelProvider rows
  # ============================================================================

  @integration @unimplemented
  Scenario: Virtual key references existing ModelProvider rows via scope inheritance
    Given a ModelProvider "openai" scoped to TEAM "platform" with key "sk-existing"
    When I create virtual key "demo-key" scoped to TEAM "platform" with no explicit RoutingPolicy
    Then the bundle materialiser resolves "openai" as eligible via TEAM-scope match
    And no duplicate credential row is created (single source of truth is the ModelProvider)
    And updating the ModelProvider's API key bumps `ModelProvider.revision`
    And the next /config materialisation for "demo-key" reflects the new key

  # Scope-cascade enforcement is exercised by the dogfood matrix
  # (Anthropic TEAM-scoped → ORG/PERSONAL VKs correctly 404; PR-body
  # Tier 1 cells). Pin as @unimplemented until a service-level
  # backfill exists for the negative path.
  @integration @unimplemented
  Scenario: Virtual key cannot select a provider outside its scope graph
    Given the chosen scope TEAM "platform" has eligible MPs ["openai", "anthropic"]
    And "bedrock" is scoped to TEAM "data-sci" only (NOT in scope for "platform")
    When I open the "new virtual key" drawer and pick scope TEAM "platform"
    Then "bedrock" is not listed in the "Eligible Model Providers" panel
    And the create flow cannot reference it; explicitly attempting via API returns 400
      with code "mp_out_of_vk_scope" naming "bedrock"

  # ============================================================================
  # Fallback chain configuration (lives on RoutingPolicy, not on the VK)
  # ============================================================================

  @integration @unimplemented
  Scenario: Per-VK chain ordering is owned by RoutingPolicy.model_provider_ids
    Given a RoutingPolicy "rp-strict" with strategy="ordered" and model_provider_ids=["anthropic", "openai", "azure"]
    And a VirtualKey "prod-key" scoped to ORGANIZATION "acme" with routingPolicyId="rp-strict"
    When the gateway materialises the /config bundle for "prod-key"
    Then `routing_policy.model_provider_ids` equals ["anthropic", "openai", "azure"]
    And `model_providers[]` order matches that sequence
    And changing the policy's model_provider_ids bumps every dependent VK's revision

  @integration @unimplemented
  Scenario: Fallback trigger conditions live on RoutingPolicy (per-policy, not per-VK)
    Given a RoutingPolicy "rp-resilient" with triggers={on:["5xx","429","timeout"], timeout_ms:30000, max_attempts:3}
    And a VirtualKey "prod-key" with routingPolicyId="rp-resilient"
    When the bundle is materialised
    Then `routing_policy.triggers` equals {on:["5xx","429","timeout"], timeout_ms:30000, max_attempts:3}
    And the gateway applies those triggers per-request, not per-VK

  # ============================================================================
  # Model aliases
  # ============================================================================

  @integration @unimplemented
  Scenario: Alias overrides provider-prefixed model
    Given I am editing virtual key "prod-key"
    When I add model alias "fast" => "openai/gpt-5-mini"
    And I click "Save"
    Then a request to the gateway with model "fast" is routed to openai/gpt-5-mini
    And a request with explicit "anthropic/claude-haiku" is routed as-is (not aliased)

  # ============================================================================
  # Rotation, revocation, restore
  # ============================================================================

  # Rotate flow uses the same hashedSecret/previousHashedSecret OR-walker
  # the dbMTP unit test now guards. Pin as @unimplemented until the
  # VirtualKeyService.rotate integration backfill lands.
  @integration @unimplemented
  Scenario: Rotate virtual key issues a new secret and invalidates the previous one
    Given virtual key "prod-key" has secret "vk-lw-01HZX9K3MA…"
    When I click "Rotate secret" on "prod-key"
    And I confirm the rotation
    Then a new secret "vk-lw-01HZX9K3MB…" is generated and shown once
    And the previous secret stays valid for 24 hours (grace window) so clients can roll over
    And an audit log entry "gateway.virtual_key.rotated" is recorded

  @integration @unimplemented
  Scenario: Rotate secret-reveal dialog surfaces the 24h grace window
    Given I rotated virtual key "prod-key" and the reveal dialog opens
    Then I see a blue info alert titled "24-hour grace window active"
    And the alert body explains the previous secret keeps working for 24 hours
    And the alert is in addition to the orange warning "You will only see this secret once"
    And the dialog title reads "Save your rotated secret" (not the create flow's "Save your virtual key secret")

  # Revoke status flip is enforced by the same multitenancy guard the
  # VK service unit tests cover. Pin as @unimplemented until the
  # auth-cache-TTL propagation test lands.
  @integration @unimplemented
  Scenario: Revoke virtual key disables authentication immediately
    Given virtual key "prod-key" is active
    When I click "Revoke" and confirm
    Then the virtual key status is "revoked"
    And the gateway returns error type "virtual_key_revoked" (401)
    And the change propagates within the configured auth-cache TTL (default 60s)

  # UI-only assertion (no Restore button on revoked rows). Pin as
  # @unimplemented until the VK list React-Testing-Library backfill
  # lands.
  @integration @unimplemented
  Scenario: Revoked virtual key cannot be restored (must mint new)
    Given virtual key "prod-key" is revoked
    When I look at its row in the list
    Then I see no "Restore" action
    And only "Archive" and "Delete" are available

  # ============================================================================
  # Environment scoping (live vs test)
  # ============================================================================

  @integration @unimplemented
  Scenario: Test-scoped keys cannot call live providers if live-only flag is set
    Given project "gateway-demo" has providers set to "live-only" mode
    When I create virtual key "scratch" with environment "test"
    Then a call to the gateway authenticating with "scratch" returns "virtual_key_environment_mismatch"
    And the error is returned without a provider call

  # ============================================================================
  # Permissions (RBAC)
  # ============================================================================

  @integration @unimplemented
  Scenario: Viewer cannot create virtual keys
    Given I am a Viewer on project "gateway-demo"
    When I open the "AI Gateway" section
    Then the "New virtual key" button is disabled
    And the API rejects virtual key creation with "forbidden"

  @integration @unimplemented
  Scenario: Member with virtualKeys:create can create but not delete
    Given I have "virtualKeys:create" but not "virtualKeys:delete"
    When I open an existing virtual key
    Then I see "Edit", "Rotate", and "Revoke" actions
    And I do not see a "Delete" action

  # ============================================================================
  # Audit and attribution
  # ============================================================================

  # auditLog.consolidation.integration.test.ts covers append shape +
  # downstream filtering; the per-VK mutation surface (create/rotate/
  # edit/revoke each writes a row) needs a VirtualKeyService coverage
  # pass. Pin as @unimplemented until that backfill lands.
  @integration @unimplemented
  Scenario: Every VK mutation writes an audit log entry
    When I create, rotate, edit, or revoke a virtual key
    Then an audit log row is written with actor, action, target vk_id,
      before and after config snapshots, and timestamp

  @integration @unimplemented
  Scenario: VK detail has a deep-link Audit history button that pre-filters the log
    Given virtual key "prod-key" has 4 audit entries (created, updated, rotated, revoked)
    When I open the VK detail page and click "Audit history"
    Then I land on /settings/audit-log?targetKind=virtual_key&targetId=vk_…
    And the audit page shows only the 4 entries for that VK
    And I see a clickable "target = vk_…" chip that clears the filter when ×-tapped

  @integration @unimplemented
  Scenario: Audit history button stays reachable even for revoked VKs
    Given virtual key "prod-key" has status "revoked"
    When I open the VK detail page
    Then the Edit / Rotate / Revoke buttons are hidden
    But the "Audit history" button is still visible so I can investigate the revocation trail

  @integration @unimplemented
  Scenario: VK detail Usage section renders populated ledger data
    Given virtual key "prod-openai" has 629 completed requests over the last 30 days
    When I open the VK detail page and scroll to "Usage (last 30 days)"
    Then I see stat tiles for Total spend, Requests, Avg $/request, and Blocked (when > 0)
    And I see a 30-day area sparkline bucketed by UTC day
    And I see Spend-by-model badges ordered by total spend desc
    And I see a Recent-debits table with When (relative-time + exact on hover), Model, Tokens in→out, Amount, Latency ms

  @integration @unimplemented
  Scenario: Request attribution includes VK principal on every trace
    Given I have virtual key "prod-key" owned by user "alice@acme"
    When a request hits the gateway with "prod-key"
    Then the resulting trace has attribute "langwatch.virtual_key.id" = vk_id
    And attribute "langwatch.principal.id" = alice's user id

  # ============================================================================
  # Internal gateway endpoints (contract tests)
  # ============================================================================

  @integration @unimplemented
  Scenario: POST /internal/gateway/resolve-key returns tiny JWT
    Given virtual key "prod-key" exists
    When the gateway calls "POST /internal/gateway/resolve-key" with the raw secret
    Then the response contains a signed JWT with claims
      { vk_id, organization_id, project_id, principal_user_id, revision, exp }
    And `project_id` is non-null only when the VK has exactly one PROJECT scope
      (else null — see vk-config-bundle.feature)
    And no provider credentials, no budget totals, no guardrail policies are in the JWT

  @integration @unimplemented
  Scenario: GET /internal/gateway/config/:vk_id returns the materialised bundle
    Given the gateway has verified a JWT for vk_id "vk_123"
    When the gateway calls "GET /internal/gateway/config/vk_123" with "If-None-Match: 42"
    And the current revision is 42
    Then the response is 304 Not Modified
    When the gateway calls the same endpoint with "If-None-Match: 41"
    Then the response is 200 with the bundle payload (shape locked in vk-config-bundle.feature)
    And the payload includes organization_id, scopes, model_providers[], routing_policy,
      key_state, and a new revision
    And the payload does NOT include `bindings[]` or `provider_credentials[]` (legacy shape)

  @integration @unimplemented
  Scenario: GET /internal/gateway/changes?since=N long-polls for mutations
    Given the gateway has seen revision 100
    When the gateway calls "GET /internal/gateway/changes?since=100&timeout=25"
    And no change occurs within 25 seconds
    Then the response is 204 No Content with header "X-LangWatch-Revision: 100"
    When a user rotates a virtual key while the long-poll is open
    Then the endpoint returns 200 with a change event and the new revision
