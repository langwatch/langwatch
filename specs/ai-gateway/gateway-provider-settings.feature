Feature: AI Gateway — Provider settings cohesion

  After the binding-collapse refactor, the LangWatch ModelProvider row IS
  the gateway's provider config. There is no separate `GatewayProviderCredential`
  table — the gateway-specific knobs (rate limits, extra headers, rotation
  policy, fallback priority, circuit-breaker state, advanced provider config)
  live on `ModelProvider` itself, surfaced as an "Advanced (Gateway)" tab in
  the existing ModelProvider drawer.

  As a project admin setting up provider credentials
  I want a single source of truth for provider credentials that both the legacy
  LangWatch stack (evaluators, prompt playground via litellm/langevals) AND the
  new LangWatch AI Gateway can consume
  So that I do not have to enter the same OpenAI/Anthropic/Bedrock API keys in
  two places and worry about them drifting

  ModelProvider rows are multi-scope (ORG / TEAM / PROJECT) via the existing
  `ModelProviderScope` table — see model-provider-scoping.feature. The same
  scope graph drives which Virtual Keys can route to which ModelProviders
  (see vk-scope-inheritance.feature). Per-VK chain order lives on
  `RoutingPolicy`, not on a binding table.

  Background:
    Given I am logged in as a member of organization "acme"
    And I have "modelProviders:manage" at ORGANIZATION "acme"

  # ============================================================================
  # ModelProvider is the single source of truth (no separate binding row)
  # ============================================================================

  # Covered by the A5 PR-body screenshot (ModelProviderAdvancedSection
  # renders no API-key input on the Advanced tab) — an automated binding
  # would require a new render test for the section. Pin as @unimplemented
  # until the broader settings-drawer integration test backfill lands.
  @integration @unimplemented
  Scenario: Enabling gateway routing on a ModelProvider does NOT re-enter the API key
    Given a ModelProvider "openai" exists scoped to ORGANIZATION "acme" with key "sk-existing"
    When I open the ModelProvider drawer for "openai"
    And I switch to the "Advanced (Gateway)" tab
    And I set rateLimitRpm=600 and rotationPolicy="auto"
    Then no API-key input is shown on the Advanced tab
    And the gateway reads the credential from the same ModelProvider row
    And the raw key never leaves the ModelProvider table

  @integration @unimplemented
  Scenario: Rotating the underlying ModelProvider API key reflects in the gateway
    Given ModelProvider "openai" key is "sk-old"
    When an admin rotates ModelProvider "openai" to "sk-new"
    Then `ModelProvider.revision` advances
    And every VK that resolves to this ModelProvider via scope-inheritance bumps revision
    And the gateway auth-cache refreshes within its background-poll interval (default 60s)
    And subsequent gateway requests use "sk-new"
    And no separate "gateway-side rotate" action is required

  @integration @unimplemented
  Scenario: Disabling a ModelProvider cascades to every VK that depended on it
    Given a ModelProvider "openai" scoped to ORGANIZATION "acme"
    And three VKs at different scopes that resolve "openai" via inheritance
    When an admin sets `ModelProvider.disabledAt` to now
    Then `ModelProvider.revision` advances
    And all three VKs' next `/config` materialisations exclude "openai" from `model_providers[]`
    And requests to those VKs fall through to the next eligible MP in the RoutingPolicy chain
    And a span event "provider_disabled_for_vk" fires on each affected VK

  # ============================================================================
  # Advanced (Gateway) section — single Save, collapsed by default, FF-gated
  # ============================================================================

  @integration
  Scenario: Advanced (Gateway) is hidden when the AI gateway feature flag is off
    Given a ModelProvider "openai" exists scoped to ORGANIZATION "acme"
    And the "release_ui_ai_gateway_menu_enabled" flag is disabled for "acme"
    When I open the ModelProvider drawer for "openai"
    Then the "Advanced (Gateway)" accordion is not rendered
    And the drawer's basic fields and Save button remain interactive

  @integration
  Scenario: Advanced (Gateway) renders as a collapsed accordion when the flag is on
    Given a ModelProvider "openai" exists scoped to ORGANIZATION "acme"
    And the "release_ui_ai_gateway_menu_enabled" flag is enabled for "acme"
    When I open the ModelProvider drawer for "openai"
    Then the "Advanced (Gateway)" accordion is rendered collapsed
    And the rate-limit, fallback priority, and provider config inputs are hidden
      until I expand the accordion

  @integration
  Scenario: Single Save persists basic credentials and advanced gateway fields together
    Given a ModelProvider "openai" exists scoped to ORGANIZATION "acme"
    And the "release_ui_ai_gateway_menu_enabled" flag is enabled for "acme"
    When I open the ModelProvider drawer for "openai"
    And I expand the "Advanced (Gateway)" accordion
    And I set rateLimitRpm=600 and providerConfig={"region":"us-east-1"}
    And I click the drawer's "Save" button
    Then the drawer closes after a single save round-trip
    And the row's rate limit AND credentials reflect the new values
    And no separate "Save Advanced" button is rendered

  # ============================================================================
  # Advanced (Gateway) writes inherit the row's scope-manage requirement
  # ============================================================================

  @integration
  Scenario: Advanced gateway writes require manage on every existing-row scope
    Given a ModelProvider "cerebras" exists scoped to ORGANIZATION "acme"
    And I am a team admin in "acme" without organization:manage
    When I send `updateModelProvider({ id, rateLimitRpm: 600 })` with no
      `scopes` array
    Then the service rejects with FORBIDDEN and does not mutate
      `rateLimitRpm`
    And the same check holds for `rateLimitTpm`, `rateLimitRpd`,
      `fallbackPriorityGlobal`, and `providerConfig`

  @integration
  Scenario: Update of a vanished id surfaces NOT_FOUND instead of silently creating
    Given I am an organization admin in "acme"
    When I send `updateModelProvider({ id: "vanished-id", projectId, provider: "groq", enabled: true, customKeys: {...} })`
      for a row that was concurrently deleted or is not visible from the
      project
    Then the service rejects with NOT_FOUND
    And no new ModelProvider row is created in the caller's project

  # ============================================================================
  # Dispatch-side stripping of unsupported sampling params
  # ============================================================================

  @integration
  Scenario: Stale top_p is stripped when the model does not support it
    Given a custom Bedrock model "us.anthropic.claude-haiku-4-5" with
      supportedParameters=["temperature"]
    And a saved prompt-config blob whose llm carries a stale top_p=1.0
    When the workflow dispatches through studioBackendPostEvent
    Then the request that reaches nlpgo carries temperature but NOT top_p
    And Bedrock no longer returns "temperature and top_p cannot both be
      specified for this model"

  # ============================================================================
  # Advanced (Gateway) tab — fields formerly on GatewayProviderCredential
  # ============================================================================

  @integration @unimplemented
  Scenario: Advanced (Gateway) tab exposes gateway-only fields
    Given a ModelProvider "openai" enabled for gateway use
    When I open the "Advanced (Gateway)" tab of the ModelProvider drawer
    Then I see fields:
      | field                  | purpose                                                 |
      | rateLimitRpm           | gateway-enforced requests per minute                    |
      | rateLimitTpm           | gateway-enforced tokens per minute                      |
      | rateLimitRpd           | gateway-enforced requests per day                       |
      | rotationPolicy         | auto / manual / external secret-store                   |
      | extraHeaders           | appended by gateway only (not by legacy evaluators)     |
      | providerConfig         | provider-specific advanced config (base URL, region)    |
      | fallbackPriorityGlobal | numeric; used when a VK has no explicit RoutingPolicy   |
      | blockedModelPatterns   | regex list; blocks gateway dispatch matching these      |
    And editing these fields advances `ModelProvider.revision`
    And the legacy litellm/evaluator dispatch path ignores all of these fields

  @integration @unimplemented
  Scenario: Extra headers added on the Advanced tab do not leak into evaluators
    Given ModelProvider "openai" has Advanced.extraHeaders={"X-Route": "prod"}
    When an evaluator or the prompt playground calls OpenAI via litellm
    Then the "X-Route" header is NOT sent
    And only the ModelProvider-level (non-Advanced) headers are sent
    And the gateway-only invariant is preserved through the legacy dispatch path

  # ============================================================================
  # Multi-deployment without slot (iter 109 pattern)
  # ============================================================================

  @integration @unimplemented
  Scenario: Multi-deployment OpenAI uses sibling ModelProvider rows (no `slot` column)
    Given a ModelProvider "OpenAI US" with providerConfig.base_url="https://api.openai.com/v1"
    And a ModelProvider "OpenAI EU" with providerConfig.base_url="https://eu.api.openai.com/v1"
    When a RoutingPolicy lists both in its model_provider_ids chain
    Then each MP appears as its own `model_providers[]` entry in the bundle
    And semantic cache scoping uses `(vk_id, model, model_provider_id, tenant_partition)` — no `slot` needed
    And the canonical multi-deployment story is "create another ModelProvider row", never a slot enum

  @integration @unimplemented
  Scenario: Self-hosted OpenAI-compatible provider is a regular ModelProvider row
    Given I add a ModelProvider "self-hosted-llama" of kind "openai" with providerConfig.base_url="https://llm.internal.acme/v1" scoped to PROJECT "demo"
    Then this MP appears in any project-scope VK's eligible set per scope inheritance
    And gateway dispatch uses the configured base URL and key

  @integration @unimplemented
  Scenario: Azure deployments are preserved on the single ModelProvider row
    Given ModelProvider "azure" has deploymentMapping={"gpt-4o": "my-deployment"} and providerConfig.api_version="2024-02-15-preview"
    When a gateway request uses model "azure/gpt-4o"
    Then the dispatch uses deployment name "my-deployment"
    And evaluators using the same ModelProvider via litellm continue to work without code change

  # ============================================================================
  # Failover health + circuit breaker
  # ============================================================================

  @integration @unimplemented
  Scenario: Provider health status lives on the ModelProvider row and informs fallback
    Given ModelProvider "openai" has been failing health checks for 2 minutes
    And the circuit breaker opens (`ModelProvider.healthStatus="circuit_open"`)
    When I open `/settings/model-providers`
    Then "openai" shows a red status dot and "circuit open" label on its row
    And gateway requests routed through it skip it until the breaker closes
    And the bundle materialiser temporarily filters it out of `model_providers[]`

  # ============================================================================
  # Permissions (RBAC) — scope-aware, no legacy admin short-circuit reliance
  # ============================================================================

  @integration @unimplemented
  Scenario: Only users with modelProviders:manage at the MP's scope can edit Advanced fields
    Given ModelProvider "openai" is scoped to ORGANIZATION "acme"
    And I have only `modelProviders:view` at ORGANIZATION "acme"
    When I open the ModelProvider drawer
    Then the "Advanced (Gateway)" tab is read-only
    And the rate-limit and extra-header inputs are disabled

  @integration @unimplemented
  Scenario: Per-scope grants flow downward
    Given a user has `modelProviders:manage` at ORGANIZATION "acme"
    When they edit Advanced fields on any MP scoped to a team or project within "acme"
    Then the edits are allowed
    And the check uses `checkUserPermissionForScope(scope, 'modelProviders:manage')` explicitly
    # No reliance on the TeamUserRole.ADMIN short-circuit at rbac.ts:715 — the
    # legacy-removal PR will drop that line without breaking this scenario.

  # ============================================================================
  # Cohesion with legacy litellm path (no regression)
  # ============================================================================

  @integration @unimplemented
  Scenario: Legacy evaluator path continues to work when no MP has Advanced fields set
    Given project "demo" has a ModelProvider "openai" with no Advanced fields populated
    When an evaluator runs via the legacy litellm path
    Then it works exactly as before, using the ModelProvider's base config
    And no gateway dispatch is invoked
    And the bundle materialiser will silently skip this MP for VKs that resolve it
      until at least one Advanced field is set (gateway needs the routing knobs)

  # ============================================================================
  # No back-compat — collapsed entities are gone
  # ============================================================================

  @integration @unimplemented
  Scenario: GatewayProviderCredential no longer exists at any API surface
    Given the refactor migration has applied
    Then `GET /api/auth/cli/governance/provider-credentials` returns 404 (route removed)
    And the tRPC router `api.gatewayProviders.*` does not exist
    And every consumer (UI, CLI, gateway-internal /config) reads from `ModelProvider` only

  @integration @unimplemented
  Scenario: VirtualKeyProviderCredential no longer exists at any API surface
    Given the refactor migration has applied
    Then no VK detail UI shows a "Provider chain bindings" section
    And the chain ordering lives on `RoutingPolicy.model_provider_ids` (see admin-routing-policies.feature)
