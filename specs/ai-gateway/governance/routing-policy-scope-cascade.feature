Feature: AI Gateway — Routing Policy multi-scope cascade

  RoutingPolicy is multi-scope (ORGANIZATION / TEAM / PROJECT) and a VK
  selects a policy from the union of policies its own scope sees, walking
  upward through the policy's scope graph. Mirrors the inheritance shape
  established for ModelProvider, ModelDefault, and VirtualKey, so the four
  scoped resources speak the same scoping vocabulary across UI, CLI, and
  the gateway materialiser.

  All scope-related schema mirrors `VirtualKeyScope` / `ModelProviderScope`
  exactly: enum `RoutingPolicyScopeType { ORGANIZATION | TEAM | PROJECT }`
  plus a `RoutingPolicyScope { routingPolicyId, scopeType, scopeId }` join
  row per assigned scope. Multiple scope rows on a policy express union
  semantics (the policy is selectable from any of those scopes). The legacy
  `RoutingPolicy.organizationId` column stays for ownership / billing
  attribution only; selectability is driven by the join table.

  ## Selectability rule (single sentence)

  A VK at scope S can select a RoutingPolicy P iff at least one of P's
  scope rows is an ancestor of S or equal to S.

  Background:
    Given organization "acme"
    And organization "acme" has team "platform" with project "demo"
    And organization "acme" has team "data-sci" with project "ml-prod"

  # ============================================================================
  # Single-scope policies — basic cascade
  # ============================================================================

  @bdd @routing-policy @scope-cascade @unimplemented
  Scenario: ORG-scoped policy is selectable by every VK in the organization
    Given a RoutingPolicy "rp-org-default" scoped to ORGANIZATION "acme"
    And a VirtualKey "vk-project-demo" scoped to PROJECT "demo"
    And a VirtualKey "vk-team-data-sci" scoped to TEAM "data-sci"
    When each VK lists its selectable routing policies
    Then "rp-org-default" appears in both VKs' selectable sets

  @bdd @routing-policy @scope-cascade @unimplemented
  Scenario: TEAM-scoped policy is invisible to sibling teams
    Given a RoutingPolicy "rp-platform-tuned" scoped to TEAM "platform"
    And a VirtualKey "vk-team-data-sci" scoped to TEAM "data-sci"
    When "vk-team-data-sci" lists its selectable routing policies
    Then "rp-platform-tuned" is NOT in the selectable set

  @bdd @routing-policy @scope-cascade @unimplemented
  Scenario: PROJECT-scoped policy is selectable only from that project
    Given a RoutingPolicy "rp-demo-only" scoped to PROJECT "demo"
    And a VirtualKey "vk-team-platform" scoped to TEAM "platform"
    And a VirtualKey "vk-project-demo" scoped to PROJECT "demo"
    When each VK lists its selectable routing policies
    Then "rp-demo-only" is in vk-project-demo's selectable set
    And "rp-demo-only" is NOT in vk-team-platform's selectable set

  # ============================================================================
  # Multi-scope policies — union semantics
  # ============================================================================

  @bdd @routing-policy @scope-cascade @unimplemented
  Scenario: Policy with two TEAM scopes is selectable from both teams
    Given a RoutingPolicy "rp-cross-team" scoped to TEAM "platform" AND TEAM "data-sci"
    And a VirtualKey "vk-team-platform" scoped to TEAM "platform"
    And a VirtualKey "vk-team-data-sci" scoped to TEAM "data-sci"
    When each VK lists its selectable routing policies
    Then "rp-cross-team" appears in both selectable sets

  # ============================================================================
  # Auto-migrated policies (R3 backfill from vk.config.modelAliases/policyRules)
  # ============================================================================

  @bdd @routing-policy @scope-cascade @r3-backfill @unimplemented
  Scenario: A VK with non-empty pre-refactor aliases gets a 1:1 migrated policy at the SAME scope
    Given a pre-refactor VirtualKey "vk-team-platform" scoped to TEAM "platform"
    And "vk-team-platform" has non-empty `vk.config.modelAliases`
    When the R3 backfill migration runs
    Then a new RoutingPolicy is minted named "vk-team-platform-migrated-aliases-YYYYMMDD"
    And that policy is scoped to TEAM "platform" only (NOT broader)
    And "vk-team-platform.routingPolicyId" is set to the new policy
    And the new policy is NOT visible to sibling VKs outside TEAM "platform"

  @bdd @routing-policy @scope-cascade @r3-backfill @unimplemented
  Scenario: A VK with empty aliases AND empty policy rules AND empty guardrails is skipped by the backfill
    Given a pre-refactor VirtualKey "vk-clean" with empty modelAliases + policyRules + guardrails
    When the R3 backfill migration runs
    Then no auto-migrated RoutingPolicy is minted for "vk-clean"
    And "vk-clean.routingPolicyId" stays NULL

  # ============================================================================
  # Resolver is the single source of truth
  # ============================================================================

  @bdd @routing-policy @scope-cascade @resolver @unimplemented
  Scenario: CLI, gateway materialiser, and UI return the same selectable policy set
    Given a VirtualKey "vk-uniform" scoped to TEAM "platform"
    When `langwatch routing-policies list --selectable-by vk-uniform` is run
    And `GET /api/internal/gateway/config/vk-uniform/policies` is fetched
    And the VK edit drawer renders the "Routing policy" select
    Then all three surfaces return the same ordered policy list
