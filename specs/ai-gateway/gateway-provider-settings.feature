Feature: AI Gateway — Provider settings cohesion
  As a project admin setting up provider credentials
  I want a single source of truth for provider credentials that both the legacy
  LangWatch stack (evaluators, prompt playground via litellm/langevals) AND the
  new LangWatch AI Gateway can consume
  So that I do not have to enter the same OpenAI/Anthropic/Bedrock API keys in
  two places and worry about them drifting

  The existing ModelProvider row (project-scoped) keeps owning the raw credentials.
  The Gateway does NOT duplicate credentials — it references ModelProvider rows
  through a new `GatewayProviderCredential` binding that carries gateway-specific
  settings (rate limits, fallback priority, extra gateway headers, rotation policy).
  This is the one place where the new product meets the old one; everything else
  in the Gateway is additive.

  Background:
    Given I am logged in
    And I have access to project "gateway-demo"
    And I have "modelProviders:manage" and "gatewayProviders:manage" permissions

  # ============================================================================
  # Existing ModelProvider rows are reused, not duplicated
  # ============================================================================

  @integration
  Scenario: Enabling a provider for the gateway does NOT re-enter the API key
    Given project "gateway-demo" has ModelProvider "openai" configured
    When I open the "AI Gateway → Providers" section
    And I click "Enable openai for the gateway"
    Then no API-key input is shown
    And the gateway binds to the existing ModelProvider row
    And the raw key never leaves the ModelProvider table

  @integration
  Scenario: Rotating the underlying ModelProvider API key reflects in the gateway
    Given "openai" is enabled for the gateway with ModelProvider key "sk-old"
    When an admin rotates ModelProvider "openai" to "sk-new"
    Then the gateway control-plane advances its revision
    And the gateway cache refreshes within its background-poll interval (default 60s)
    And subsequent gateway requests use "sk-new"
    And no user action is required in the Gateway UI

  @integration
  Scenario: Disabling a ModelProvider also disables its gateway binding
    Given "openai" is enabled for the gateway
    When an admin disables the ModelProvider row
    Then the gateway binding is soft-disabled
    And any virtual key referencing it emits a "provider_disabled" warning
    And requests to those virtual keys fall through to the fallback chain

  # ============================================================================
  # Gateway-specific provider settings (layered on top of ModelProvider)
  # ============================================================================

  @integration
  Scenario: Gateway-only fields live on GatewayProviderCredential
    Given "openai" is enabled for the gateway
    When I open "AI Gateway → Providers → openai"
    Then I see fields that belong to the gateway binding only:
      | field                  | purpose                                               |
      | rateLimitRpm           | gateway-enforced requests per minute                  |
      | rateLimitTpm           | gateway-enforced tokens per minute                    |
      | rotationPolicy         | auto / manual / external secret-store                 |
      | extraHeaders           | appended by gateway only (not by legacy evaluators)   |
      | fallbackPriorityGlobal | numeric; used when a VK has no explicit chain         |
    And editing these fields does not mutate the underlying ModelProvider row

  @integration
  Scenario: Extra headers added at the gateway binding do not leak into evaluators
    Given "openai" is enabled for the gateway with gateway extraHeader "X-Route: prod"
    When an evaluator or the prompt playground calls OpenAI via litellm
    Then the "X-Route" header is NOT sent
    And only the ModelProvider-level extraHeaders are sent

  # ============================================================================
  # Custom / self-hosted / OpenAI-compatible providers
  # ============================================================================

  @integration
  Scenario: Self-hosted OpenAI-compatible provider is usable from the gateway
    Given I add a ModelProvider of kind "openai" with base URL "https://llm.internal.acme/v1"
    When I enable this ModelProvider for the gateway
    Then the gateway binding lists this provider under "openai-compatible"
    And requests routed here use the configured base URL and key

  @integration
  Scenario: Azure deployments are preserved across gateway and legacy paths
    Given "azure" is configured with deployment mapping { "gpt-4o": "my-deployment" }
    When a gateway request uses model "azure/gpt-4o"
    Then the dispatch uses deployment name "my-deployment"
    And an evaluator using the same mapping via litellm continues to work as before

  # ============================================================================
  # Failover health + circuit breaker
  # ============================================================================

  @integration
  Scenario: Provider health status is visible and informs fallback
    Given "openai" has been failing health checks for 2 minutes
    When I open "AI Gateway → Providers"
    Then "openai" shows a red status dot and "circuit open" label
    And gateway requests with fallback enabled skip it until the breaker closes

  # ============================================================================
  # Permissions (RBAC)
  # ============================================================================

  @integration
  Scenario: Only users with gatewayProviders:manage can enable/disable for gateway
    Given I have "modelProviders:manage" but not "gatewayProviders:manage"
    When I open "AI Gateway → Providers"
    Then the "Enable for gateway" toggle is disabled
    And the rate-limit and extra-header fields are read-only

  @integration
  Scenario: gatewayProviders:view grants view-only access
    Given I have only "gatewayProviders:view"
    When I open "AI Gateway → Providers"
    Then I see the list of providers and their gateway bindings
    And all mutation controls are disabled

  # ============================================================================
  # Cohesion with legacy litellm path (no regression)
  # ============================================================================

  @integration
  Scenario: Legacy evaluator path continues to work when gateway is disabled
    Given project "gateway-demo" has NOT enabled any provider for the gateway
    When an evaluator runs via the legacy litellm path
    Then it works exactly as before, using ModelProvider rows directly
    And no gateway call is made
