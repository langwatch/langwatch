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

  Scenario: Picking a scope renders the resolved model set inline
    Given I have virtualKeys:manage on ORGANIZATION "acme"
    And ModelProvider "openai-org" with chat models "gpt-5-mini, gpt-4o-mini"
    And ModelProvider "anthropic-team-platform" with chat models "claude-3-5-haiku"
    When I open the VK create drawer
    And I pick scope ORGANIZATION "acme"
    Then I see "This VK will be usable within ORGANIZATION:acme and can fall back to 2 models (gpt-5-mini, gpt-4o-mini)"
    When I change the scope to TEAM "platform"
    Then I see "This VK will be usable within TEAM:platform and can fall back to 3 models (gpt-5-mini, gpt-4o-mini, claude-3-5-haiku)"
    And each model row shows a "via ORG"/"via TEAM:platform" chip naming the inherited-from scope

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
