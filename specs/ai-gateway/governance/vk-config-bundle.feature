Feature: AI Gateway — Virtual Key /config bundle materialisation

  Locks the wire shape and ordering rules for `GET /api/internal/gateway/config/:vk_id`,
  the control-plane endpoint the Go gateway calls to assemble the routable
  bundle for an incoming VK request. After the VirtualKeyProviderCredential
  binding table is gone, the bundle is assembled at materialise-time from
  the VK's scope graph (see vk-scope-inheritance.feature), not from a
  pre-baked join table.

  ## Why this spec exists

  Before the refactor, /config read a flat join table for ordering: the
  per-VK `VirtualKeyProviderCredential.priority` column. After the refactor,
  ordering becomes a derived computation. Without a deterministic rule,
  the Go side would receive a non-reproducible `model_providers[]` ordering
  driven by Object.keys() walk order — flaky tests, irreproducible bundles,
  and silent fallback-chain changes across deployments. This spec is the
  contract that prevents that.

  ## Bundle shape (v2)

  ```json
  {
    "vk_id": "01HZX...",
    "revision": 42,
    "organization_id": "org_abc",
    "principal_user_id": null,
    "scopes": [
      { "scope_type": "TEAM", "scope_id": "team_platform" }
    ],
    "model_providers": [
      {
        "id": "mp_openai_org",
        "provider": "openai",
        "name": "OpenAI",
        "scope": { "scope_type": "ORGANIZATION", "scope_id": "org_abc" },
        "rate_limit_rpm": 600,
        "rate_limit_tpm": null,
        "extra_headers": {},
        "provider_config": { "base_url": "https://api.openai.com/v1" },
        "models": ["gpt-5-mini", "gpt-4o-mini"],
        "credential_ref": "credref_xxx"
      }
    ],
    "routing_policy": {
      "id": "rp_default_acme",
      "scope": { "scope_type": "ORGANIZATION", "scope_id": "org_abc" },
      "strategy": "ordered",
      "model_provider_ids": ["mp_openai_org", "mp_anthropic_team_platform"],
      "credential_overrides": null
    },
    "key_state": {
      "model_aliases": { "fast": "gpt-5-mini" },
      "models_allowed": null
    }
  }
  ```

  No `bindings[]` array. No nested provider-credential chain. `model_providers[]`
  is flat, fully-resolved, and ordered. `routing_policy.model_provider_ids[]` is
  the ordered chain (replaces the legacy per-VK `priority` column).

  Background:
    Given organization "acme"
    And a ModelProvider "mp_openai_org" scoped to ORGANIZATION "acme" with fallbackPriorityGlobal=10 and createdAt "2026-04-01T00:00:00Z"
    And a ModelProvider "mp_anthropic_org" scoped to ORGANIZATION "acme" with fallbackPriorityGlobal=20 and createdAt "2026-04-15T00:00:00Z"
    And a ModelProvider "mp_vertex_team" scoped to TEAM "platform" with fallbackPriorityGlobal=10 and createdAt "2026-05-01T00:00:00Z"

  # ============================================================================
  # Deterministic ordering rule
  # ============================================================================

  Scenario: VK with a RoutingPolicy uses the policy's model_provider_ids order verbatim
    Given a RoutingPolicy "rp_strict" with strategy="ordered" and model_provider_ids=["mp_anthropic_org", "mp_openai_org"]
    And a VirtualKey "vk_with_policy" scoped to ORGANIZATION "acme" with routingPolicyId="rp_strict"
    When the materialiser assembles the bundle for "vk_with_policy"
    Then `model_providers[0].id` equals "mp_anthropic_org"
    And `model_providers[1].id` equals "mp_openai_org"
    And `routing_policy.model_provider_ids` equals `["mp_anthropic_org", "mp_openai_org"]`

  Scenario: VK with no RoutingPolicy orders by ModelProvider.fallbackPriorityGlobal then createdAt
    Given a VirtualKey "vk_no_policy" scoped to TEAM "platform" with routingPolicyId=null
    When the materialiser assembles the bundle for "vk_no_policy"
    Then `model_providers[]` is ordered first by fallbackPriorityGlobal ascending
    And ties on fallbackPriorityGlobal are broken by createdAt ascending
    And the result is: ["mp_vertex_team" (prio=10 created 2026-05-01), "mp_openai_org" (prio=10 created 2026-04-01), "mp_anthropic_org" (prio=20)]
    # Wait — createdAt asc means earlier-created wins on ties. Re-state:
    And the correct deterministic ordering for the bundle is: ["mp_openai_org", "mp_vertex_team", "mp_anthropic_org"]
    And `routing_policy` is null in the response
    And the gateway tags the request span attribute `langwatch.routing.source = "default_fallback"`

  Scenario: Ordering is stable across repeated materialisation calls
    Given a VirtualKey "vk_stable" scoped to ORGANIZATION "acme" with routingPolicyId=null
    When the materialiser assembles the bundle 100 times back-to-back
    Then every response yields the same `model_providers[].id` sequence
    And no permutation differs between runs (no Object.keys-walk drift)

  # ============================================================================
  # Eligible set follows the scope-inheritance resolver
  # ============================================================================

  Scenario: Bundle's model_providers[] equals the resolved eligible set from vk-scope-inheritance
    Given a VirtualKey "vk_team_platform" scoped to TEAM "platform"
    When the materialiser assembles the bundle for "vk_team_platform"
    Then every `model_providers[].id` is in the eligible set per vk-scope-inheritance.feature for scope TEAM:platform
    And no MP outside that eligible set appears in the bundle

  Scenario: A RoutingPolicy referencing an MP outside the VK's eligible set drops that MP from the bundle
    Given a RoutingPolicy "rp_overreach" with model_provider_ids=["mp_openai_org", "mp_vertex_team", "mp_azure_other_team"]
    And ModelProvider "mp_azure_other_team" is scoped to TEAM "data-sci" (not in vk's scope graph)
    And a VirtualKey "vk_filtered" scoped to TEAM "platform" with routingPolicyId="rp_overreach"
    When the materialiser assembles the bundle for "vk_filtered"
    Then `model_providers[]` contains "mp_openai_org" and "mp_vertex_team"
    And `model_providers[]` does NOT contain "mp_azure_other_team"
    And `routing_policy.model_provider_ids` reflects the filter: ["mp_openai_org", "mp_vertex_team"]
    And a span event "routing_policy_filtered" is emitted with reason="mp_out_of_vk_scope" and dropped_ids=["mp_azure_other_team"]

  # ============================================================================
  # Wire shape contract — no legacy fields
  # ============================================================================

  Scenario: Bundle response does not include any binding-era fields
    When any /config/:vk_id call returns 200
    Then the JSON does not contain the key "bindings"
    And the JSON does not contain the key "provider_credentials"
    And no `model_providers[]` element contains nested chain references

  Scenario: organization_id is always present and stable for the lifetime of the VK
    When any /config/:vk_id call returns 200
    Then `organization_id` is a non-empty string
    And `organization_id` equals `VirtualKey.organizationId` in the control plane
    And the value never changes between materialisations for the same VK

  Scenario: scopes[] reflects the VirtualKeyScope rows verbatim
    Given a VirtualKey "vk_multi_scope" with scope rows [{TEAM, "platform"}, {TEAM, "data-sci"}]
    When the materialiser assembles the bundle
    Then `scopes[]` has exactly two entries
    And the entries are sorted by `scope_type` ascending then `scope_id` ascending for determinism

  # ============================================================================
  # JWT trace project_id claim
  # ============================================================================

  ## The claim is the destination stored on the key, read back. It is decided
  ## once, when the key is written, by the rules in
  ## specs/ai-gateway/virtual-key-creation.feature, and nothing on this path
  ## re-derives it:
  ##   (a) the key's stored destination        → that project's id
  ##   (b) the key has none                    → the claim is present and null (no 500)
  ##
  ## Why a shared key still gets one: TEAM/ORG-owned VKs need somewhere to file
  ## their spans so that a single "AI Governance" trace-search filter surfaces
  ## all VK + receiver traffic in one place. Creation gives them the org's
  ## `internal_governance` project when there is nothing else to name, which is
  ## the same project AI Governance ingestion-sources point at, so trace search
  ## semantics are consistent across the governance surface.
  ##
  ## Why (b) is null and not 500: older self-hosted deployments pre-governance
  ## may have keys written when there was no `internal_governance` project to
  ## give them. The bundle nulling the claim (instead of erroring) is
  ## forward-compatible: those deployments simply won't see those VKs' spans in
  ## any project filter, which matches their existing behavior.

  Scenario: JWT project_id is the destination stored on the key
    Given a VirtualKey "vk_one_project" whose traces land in project "demo"
    When /resolve-key returns the signed JWT
    Then the JWT claim `project_id` equals "demo"
    And traces from this VK's requests land in project "demo" trace search

  Scenario: A shared key carries the governance project it was given at creation
    Given organization "acme" has an `internal_governance` project with id "proj_int_gov_acme"
    And a VirtualKey "vk_org_scoped" scoped to ORGANIZATION "acme" that named no destination
    When /resolve-key returns the signed JWT
    Then the JWT claim `project_id` equals "proj_int_gov_acme"
    And traces from this VK's requests land in project "internal_governance" trace search

  Scenario: Bundle nulls project_id when the key has no stored destination
    Given organization "legacy_self_hosted" has NO `internal_governance` project
    And a VirtualKey "vk_legacy_org_scoped" written before it had a destination to store
    When /resolve-key returns the signed JWT
    Then the JWT claim `project_id` is null
    And the /config bundle responds 200 (no 500)
    # Older self-hosted deployments without governance-stack provisioning hit
    # this path. They were never able to file these spans into a per-project
    # view under the legacy model either, so this is behaviorally compatible.

  Scenario: Editing a key's scopes does not move the project_id claim
    Given organization "acme" has an `internal_governance` project
    And a VirtualKey "vk_org" scoped to ORGANIZATION "acme"
    When the org admin adds a new TEAM scope row to "vk_org"
    Then `VirtualKey.revision` increments
    But the JWT `project_id` claim still equals the destination stored on the key
    # The destination is a decision the key carries, not one its access scopes
    # imply, so adding or removing scopes cannot move where its spend is counted.

  Scenario: A destination the customer deleted still receives the key's traces
    Given a VirtualKey "vk_doomed" whose stored destination has since been deleted
    When /resolve-key returns the signed JWT
    Then the JWT claim `project_id` still equals that project
    And the /config bundle responds 200 (no 500)
    # Deletion is soft, so the spans stay whole and reappear if the customer
    # restores the project. Rerouting would scatter one key's history across
    # two projects for an act performed on a different screen.

  # ============================================================================
  # Revision bumps invalidate auth-cache
  # ============================================================================

  Scenario: Any change in the resolved bundle bumps VirtualKey.revision
    Given a VirtualKey "vk_revisioned" with revision=10
    When an admin adds a new ModelProvider in the VK's scope graph
    Or an admin changes the VK's RoutingPolicy
    Or an admin adds a new VirtualKeyScope row to the VK
    Then `VirtualKey.revision` increments to 11
    And the gateway's auth-cache entry for this VK is evicted on next read
    And the next /config materialisation returns the new bundle shape
