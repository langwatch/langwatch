Feature: AI Gateway — Virtual Key scope inheritance

  Virtual keys are multi-scope (ORGANIZATION / TEAM / PROJECT) and inherit
  routable ModelProviders by walking upward through their scope graph,
  mirroring the inheritance rule already established for ModelDefaultConfig.
  This feature pins the resolver semantics — the single source of truth
  for "which models can this VK route to" across the create drawer, the
  CLI, the gateway materialiser, and the trace-attribution path.

  All scope-related schema mirrors `ModelProviderScope` exactly:
  enum `VirtualKeyScopeType { ORGANIZATION | TEAM | PROJECT }` plus a
  `VirtualKeyScope { virtualKeyId, scopeType, scopeId }` join row per
  assigned scope. Multiple scope rows on a VK express union semantics
  ("this VK is usable within team A OR team B"). `principalUserId`
  stays orthogonal: a personal VK can have any scope; the principal
  column is a "who owns this" marker, not a scope.

  ## Inheritance rule (single sentence)

  A VK at scope S sees a ModelProvider P iff P's scope is an ancestor of
  S OR equal to S. ORG is the broadest, then TEAM, then PROJECT.

  Background:
    Given organization "acme"
    And organization "acme" has team "platform" with project "demo"
    And organization "acme" has team "data-sci" with project "ml-prod"

  # ============================================================================
  # Single-scope VKs — basic cascade
  # ============================================================================

  Scenario: ORG-scoped VK sees only org-scoped ModelProviders
    Given a ModelProvider "openai-org" scoped to ORGANIZATION "acme"
    And a ModelProvider "anthropic-team-platform" scoped to TEAM "platform"
    And a ModelProvider "azure-project-demo" scoped to PROJECT "demo"
    And a VirtualKey "vk-org" scoped to ORGANIZATION "acme"
    When the gateway materialises the eligible ModelProvider set for "vk-org"
    Then the set contains "openai-org"
    And the set does not contain "anthropic-team-platform"
    And the set does not contain "azure-project-demo"

  Scenario: TEAM-scoped VK sees its team's MPs plus org-scoped MPs
    Given a ModelProvider "openai-org" scoped to ORGANIZATION "acme"
    And a ModelProvider "anthropic-team-platform" scoped to TEAM "platform"
    And a ModelProvider "vertex-team-data-sci" scoped to TEAM "data-sci"
    And a VirtualKey "vk-team-platform" scoped to TEAM "platform"
    When the gateway materialises the eligible ModelProvider set for "vk-team-platform"
    Then the set contains "openai-org"
    And the set contains "anthropic-team-platform"
    And the set does not contain "vertex-team-data-sci"

  Scenario: PROJECT-scoped VK sees its project's MPs plus its team's MPs plus org-scoped MPs
    Given a ModelProvider "openai-org" scoped to ORGANIZATION "acme"
    And a ModelProvider "anthropic-team-platform" scoped to TEAM "platform"
    And a ModelProvider "azure-project-demo" scoped to PROJECT "demo"
    And a ModelProvider "bedrock-project-ml-prod" scoped to PROJECT "ml-prod"
    And a VirtualKey "vk-project-demo" scoped to PROJECT "demo"
    When the gateway materialises the eligible ModelProvider set for "vk-project-demo"
    Then the set contains "openai-org"
    And the set contains "anthropic-team-platform"
    And the set contains "azure-project-demo"
    And the set does not contain "bedrock-project-ml-prod"

  # ============================================================================
  # Multi-scope VKs — union semantics
  # ============================================================================

  Scenario: VK with two TEAM scopes sees the union of both teams' eligible sets
    Given a ModelProvider "openai-org" scoped to ORGANIZATION "acme"
    And a ModelProvider "anthropic-team-platform" scoped to TEAM "platform"
    And a ModelProvider "vertex-team-data-sci" scoped to TEAM "data-sci"
    And a VirtualKey "vk-cross-team" scoped to TEAM "platform" AND TEAM "data-sci"
    When the gateway materialises the eligible ModelProvider set for "vk-cross-team"
    Then the set contains "openai-org"
    And the set contains "anthropic-team-platform"
    And the set contains "vertex-team-data-sci"

  Scenario: VK with PROJECT scope plus an unrelated TEAM scope sees both branches
    Given a ModelProvider "anthropic-team-platform" scoped to TEAM "platform"
    And a ModelProvider "vertex-team-data-sci" scoped to TEAM "data-sci"
    And a ModelProvider "azure-project-demo" scoped to PROJECT "demo"
    And a VirtualKey "vk-mixed" scoped to PROJECT "demo" AND TEAM "data-sci"
    When the gateway materialises the eligible ModelProvider set for "vk-mixed"
    Then the set contains "anthropic-team-platform"
    And the set contains "azure-project-demo"
    And the set contains "vertex-team-data-sci"

  # ============================================================================
  # Personal VK — orthogonal principal flag, scopes still apply
  # ============================================================================

  Scenario: Personal VK with ORG scope inherits org-level MPs like any ORG-scoped VK
    Given user "ariana@acme.test" is a member of organization "acme"
    And a ModelProvider "openai-org" scoped to ORGANIZATION "acme"
    And a ModelProvider "anthropic-team-platform" scoped to TEAM "platform"
    And a VirtualKey "vk-personal-ariana" minted via CLI device-flow
    And "vk-personal-ariana" has principalUserId "ariana@acme.test" and scope ORGANIZATION "acme"
    When the gateway materialises the eligible ModelProvider set for "vk-personal-ariana"
    Then the set contains "openai-org"
    And the set does not contain "anthropic-team-platform"
    And the personal-VK semantics drive only budget pivot and audit attribution, not routing

  # ============================================================================
  # Empty intersection — no routable models
  # ============================================================================

  Scenario: VK scoped to a project with no inherited MPs has an empty eligible set
    Given organization "acme" has team "isolated" with project "no-providers"
    And no ModelProvider is scoped to ORGANIZATION "acme", TEAM "isolated", or PROJECT "no-providers"
    And a VirtualKey "vk-orphan" scoped to PROJECT "no-providers"
    When the gateway materialises the eligible ModelProvider set for "vk-orphan"
    Then the set is empty
    And POST /v1/messages with this VK returns 502 with code "no_routable_providers"

  Scenario: VK create drawer disables "Issue key" when the chosen scope has no eligible MPs
    Given I have virtualKeys:manage on PROJECT "no-providers"
    And no ModelProvider is in scope for "no-providers"
    When I open the VK create drawer and pick scope PROJECT "no-providers"
    Then the "Eligible Model Providers" panel renders empty-state copy: "No model providers visible at this scope. Ask an admin to add one at /settings/model-providers."
    And the "Issue key" CTA is disabled
    And the tooltip on the disabled CTA reads "Add a ModelProvider in scope before issuing a key."

  # ============================================================================
  # Inline UX explainer — scope picker drives live preview
  # ============================================================================

  Scenario: Picking a scope renders the resolved provider set inline
    Given I have virtualKeys:manage on ORGANIZATION "acme"
    And ModelProvider "openai-org" with chat models "gpt-5-mini, gpt-4o-mini"
    And ModelProvider "anthropic-team-platform" with chat models "claude-3-5-haiku"
    When I open the VK create drawer
    And I pick scope ORGANIZATION "acme"
    Then I see "This key works in acme and can route to 1 provider (2 models)"
    When I change the scope to TEAM "platform"
    Then I see "This key works in platform and can route to 2 providers (3 models)"
    And the summary names the scopes the way the user picked them, never as a raw scope type

  # ============================================================================
  # Attribution — a row names the scope the provider is DEFINED at
  # ============================================================================

  Scenario: An org-scoped provider inherited into a project is attributed to the organization
    Given a ModelProvider "openai-org" scoped to ORGANIZATION "acme"
    And a ModelProvider "azure-project-demo" scoped to PROJECT "demo"
    And I have virtualKeys:manage on PROJECT "demo"
    When I open the VK create drawer and pick scope PROJECT "demo"
    Then the "Eligible model providers" panel shows 2 entries
    And the "openai-org" row is attributed to organization "acme"
    And the "azure-project-demo" row is attributed to project "demo"
    # The key's own scope is never a substitute for where the provider lives:
    # an inherited provider must not read as though the project configured it.

  Scenario: A provider reachable through several tiers is attributed to the broadest one
    Given a ModelProvider "openai-wide" scoped to ORGANIZATION "acme" AND PROJECT "demo"
    And I have virtualKeys:manage on PROJECT "demo"
    When I open the VK create drawer and pick scope PROJECT "demo"
    Then the "openai-wide" row is attributed to organization "acme"

  Scenario: Scope attribution uses the same scope chip as every other settings surface
    Given a ModelProvider "openai-org" scoped to ORGANIZATION "acme"
    When I open the VK create drawer and pick any scope that reaches it
    Then the row's scope reads exactly like the Scope column on Settings → Model Providers
    And hovering it explains which kind of scope it is

  # ============================================================================
  # Only routable providers are eligible (no advertising pulled credentials)
  # ============================================================================

  Scenario: A provider an admin turned off is not offered to a new key
    Given a ModelProvider "openai-org" scoped to ORGANIZATION "acme"
    And a ModelProvider "groq-org" scoped to ORGANIZATION "acme"
    When an admin turns "groq-org" off at Settings → Model Providers
    And I open the VK create drawer and pick scope PROJECT "demo"
    Then the "Eligible model providers" panel shows only "openai-org"
    And the summary counts 1 provider
    And the gateway would refuse to route to "groq-org" for any key in this scope

  Scenario: A provider an admin removed is not offered to a new key
    Given a ModelProvider "gemini-org" scoped to ORGANIZATION "acme"
    And a VirtualKey create drawer open at scope PROJECT "demo"
    When an admin removes "gemini-org" at Settings → Model Providers
    And I reopen the VK create drawer at scope PROJECT "demo"
    Then "gemini-org" is not listed
    And no key can be issued that routes to it
    # A key that advertises a withdrawn credential is a governance hole, not a
    # stale count: the drawer must never widen a key's reach past what the
    # gateway will actually dispatch to.

  Scenario: The drawer and the gateway agree on which providers are routable
    Given a VirtualKey "vk-project-demo" scoped to PROJECT "demo"
    And some providers in scope are turned off and some are removed
    When the drawer renders the eligible providers for that scope
    And the gateway materialises the eligible ModelProvider set for "vk-project-demo"
    Then both contain exactly the same providers

  Scenario: The same provider is never listed twice
    Given a ModelProvider "openai-wide" scoped to ORGANIZATION "acme" AND TEAM "platform" AND PROJECT "demo"
    And a VirtualKey create drawer open at scope PROJECT "demo"
    Then "openai-wide" appears exactly once
    And the provider count counts it once

  # ============================================================================
  # Resolver is the single source of truth (no shadow filters)
  # ============================================================================

  Scenario: CLI, gateway, and UI all return the same eligible set for a given VK
    Given a VirtualKey "vk-uniform" scoped to TEAM "platform"
    When `langwatch virtual-keys describe vk-uniform --models` is run
    And `GET /api/internal/gateway/config/vk-uniform/models` is fetched
    And the AI Gateway page renders the VK's "Routable models" section
    Then all three surfaces return the same ordered model list
    And the ordering follows the rule in vk-config-bundle.feature

  Scenario: Adding a new ModelProvider at a broader scope immediately broadens existing VKs' eligible sets
    Given a VirtualKey "vk-team-platform" scoped to TEAM "platform"
    And the eligible ModelProvider set currently contains "anthropic-team-platform"
    When an admin creates a new ModelProvider "vertex-org" scoped to ORGANIZATION "acme"
    Then the next /config materialisation for "vk-team-platform" includes "vertex-org"
    And the VK revision is bumped to invalidate gateway auth-cache entries
    And a span event "vk_eligibility_changed" is emitted with reason="new_mp_in_ancestor_scope"
