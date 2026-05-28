Feature: AI Gateway — Routing Policy owns model aliases + policy rules

  Model aliases and policy rules (deny/allow tools, mcp, urls, models)
  live on RoutingPolicy, not on VirtualKey. A VK references a policy via
  `routingPolicyId`; the gateway materialiser resolves the cascade and
  populates `model_aliases` + `policy_rules` on the bundle wire shape.
  This lets operators mint and rotate VKs without re-authoring per-key
  routing rules — admins curate the policies once, devs pick one when
  they create a key.

  Pre-refactor: each VK carried its own `config.modelAliases` Record and
  `config.policyRules` block. Post-refactor: those fields are stripped from
  the VK row, hoisted onto `RoutingPolicy`, and the gateway bundle reads
  them from the cascade-resolved policy.

  Background:
    Given organization "acme" exists
    And the org has connected ModelProviders "openai-org" (ORG) and "anthropic-team-platform" (TEAM:platform)
    And the RoutingPolicy schema carries `modelAliases jsonb` and `policyRules jsonb`
    And the bundle wire shape v2 ships `model_aliases` + `policy_rules` at top-level

  # ============================================================================
  # Field migration: fields no longer live on VK
  # ============================================================================

  @bdd @routing-policy @aliases @r3 @unimplemented
  Scenario: VK schema no longer has modelAliases or policyRules columns
    When the post-refactor schema is inspected
    Then `VirtualKey.config` has no `modelAliases` key
    And `VirtualKey.config` has no `policyRules` key
    And `RoutingPolicy.modelAliases` is a non-null jsonb defaulting to `{}`
    And `RoutingPolicy.policyRules` is a non-null jsonb defaulting to the empty rules shape

  @bdd @routing-policy @aliases @r3 @unimplemented
  Scenario: VK without a routing policy gets the default empty alias + rules set
    Given a VirtualKey "vk-no-policy" with routingPolicyId = NULL
    When the gateway materialises the bundle for "vk-no-policy"
    Then `bundle.model_aliases` is an empty object `{}`
    And `bundle.policy_rules` is the empty-rules shape (deny: [], allow: [])

  @bdd @routing-policy @aliases @r3 @unimplemented
  Scenario: VK with a routing policy reads aliases + rules from the resolved policy
    Given a RoutingPolicy "rp-curated" with modelAliases `{"gpt-4o":"gpt-4o-mini"}` and one deny rule for tool "shell"
    And a VirtualKey "vk-uses-curated" with routingPolicyId = "rp-curated"
    When the gateway materialises the bundle for "vk-uses-curated"
    Then `bundle.model_aliases` equals `{"gpt-4o":"gpt-4o-mini"}`
    And `bundle.policy_rules.deny` contains `{type:"tool", value:"shell"}`

  # ============================================================================
  # Bundle wire-shape contract (v2)
  # ============================================================================

  @bdd @routing-policy @bundle @r3 @unimplemented
  Scenario: Materialiser bumps config_version when emitting the v2 shape
    Given a VirtualKey "vk-any" with routingPolicyId resolved through the cascade
    When the materialiser emits the bundle
    Then `bundle.config_version` is "v2"
    And the gateway resolver verifies version=="v2" before consuming `model_aliases` / `policy_rules`
    And a stale bundle with version=="v1" is refetched from the control plane
    And precedent for the version-gate is PR #3327's Bifrost cache-resolver

  # ============================================================================
  # RBAC — granular perm strings
  # ============================================================================

  @bdd @routing-policy @rbac @aliases @unimplemented
  Scenario: routingPolicies:editAliases is required to mutate modelAliases
    Given user "ariana@acme.test" holds `routingPolicies:view` but NOT `routingPolicies:editAliases`
    When ariana calls `routingPolicy.upsert` with a non-empty modelAliases payload on an existing RP
    Then the call returns FORBIDDEN with code "missing_perm:routingPolicies:editAliases"
    And the RP modelAliases column is unchanged

  @bdd @routing-policy @rbac @policy-rules @unimplemented
  Scenario: routingPolicies:editPolicyRules is required to mutate policyRules
    Given user "ariana@acme.test" holds `routingPolicies:view` but NOT `routingPolicies:editPolicyRules`
    When ariana calls `routingPolicy.upsert` with a non-empty policyRules payload on an existing RP
    Then the call returns FORBIDDEN with code "missing_perm:routingPolicies:editPolicyRules"

  @bdd @routing-policy @rbac @role-defaults @unimplemented
  Scenario: Default role grants for the new perms
    Then ORGANIZATION:ADMIN holds `routingPolicies:editAliases` AND `routingPolicies:editPolicyRules`
    And ORGANIZATION:VIEWER holds neither
    And TEAM:ADMIN holds both at team scope only (scope-bounded grant)
    And ORGANIZATION:DEVELOPER holds neither by default

  # ============================================================================
  # Audit emission
  # ============================================================================

  @bdd @routing-policy @audit @unimplemented
  Scenario: Editing aliases or policy rules emits an AuditLog row
    Given a RoutingPolicy "rp-curated" exists
    When carol@acme.com edits the aliases or policy rules on "rp-curated"
    Then exactly one AuditLog row is emitted per save with:
      | field      | value                                          |
      | action     | "routingPolicy.editAliases" or ".editRules"    |
      | actorId    | carol's userId                                 |
      | targetId   | "rp-curated"                                   |
      | category   | "configuration_change"                         |
    And the row includes a redacted before/after diff of the affected field
