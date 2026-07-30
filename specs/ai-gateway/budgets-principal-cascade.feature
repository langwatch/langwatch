Feature: AI Gateway — Per-user (PRINCIPAL) budgets in the strictest-wins cascade
  As an admin governing AI spend
  I want to set per-user (PRINCIPAL) budgets that participate in the same
  cascade as ORG/TEAM/PROJECT/VIRTUAL_KEY scopes
  So that I can cap individual developer spend without rewriting team
  or project budgets

  Builds on specs/ai-gateway/budgets.feature §Budget creation. The cascade
  contract is: a single request is checked against every budget that
  applies (org + team + project + virtual_key + principal). Any scope in
  breach with on_breach=BLOCK rejects the request; warn breaches collect
  into the warning header. PRINCIPAL is the tightest of the five.

  This spec pins: a) PRINCIPAL kind round-trips through the gatewayBudgets
  tRPC `create` procedure, b) `applicableForRequest` returns it alongside
  the other four scopes, and c) when PRINCIPAL is the only scope in
  breach, the cascade still BLOCKs.

  Background:
    Given organization "acme" exists with team "platform" and project "gateway-demo"
    And project "gateway-demo" has an active virtual key "prod-key"
    And alice is a member of "platform" with userId "user_alice"
    And I have "gatewayBudgets:manage" permission on organization "acme"

  # ============================================================================
  # PRINCIPAL kind through tRPC create
  # ============================================================================

  @bdd @phase-1b @principal-cascade @create
  Scenario: Admin creates a PRINCIPAL-scope budget via tRPC
    When I call `gatewayBudgets.create({ organizationId: "acme", scope: { kind: "PRINCIPAL", principalUserId: "user_alice" }, window: "MONTH", limitUsd: "50.00", onBreach: "BLOCK" })`
    Then the response includes `id` and `scopeType: "PRINCIPAL"` and `scopeId: "user_alice"`
    And the row is persisted with `scopeType=PRINCIPAL`, `scopeId="user_alice"`, `archivedAt=null`

  @bdd @phase-1b @principal-cascade @create
  Scenario: PRINCIPAL-scope budget rejects a userId from another organization
    Given user "user_outsider" is NOT a member of "acme"
    When I call `gatewayBudgets.create({ organizationId: "acme", scope: { kind: "PRINCIPAL", principalUserId: "user_outsider" }, ... })`
    Then the response is BAD_REQUEST with message mentioning "principalUserId is not a member of this organization"
    And no row is created

  # ============================================================================
  # Cascade — PRINCIPAL is the strictest blocker
  # ============================================================================

  @bdd @phase-1b @principal-cascade @enforcement
  Scenario: PRINCIPAL budget BLOCKs even when ORG/TEAM/PROJECT/VK budgets are under-limit
    Given organization "acme" has a $1000/month ORG budget on_breach=BLOCK with $100 spent
    And team "platform" has a $500/month TEAM budget on_breach=BLOCK with $100 spent
    And project "gateway-demo" has a $200/month PROJECT budget on_breach=BLOCK with $100 spent
    And virtual key "prod-key" has a $150/month VK budget on_breach=BLOCK with $100 spent
    And alice has a $50/month PRINCIPAL budget on_breach=BLOCK with $49.50 spent
    When the gateway estimates a $1.00 cost for an alice-attributed request
    And calls `budget.check({ organizationId: "acme", teamId: "platform", projectId: "gateway-demo", virtualKeyId: "prod-key", principalUserId: "user_alice", projectedCostUsd: "1.00" })`
    Then the response `decision` is "BLOCK"
    And `blockedBy` contains exactly one row with `scope: "principal"` and `scopeId: "user_alice"`
    And `blockReason` mentions "scope=principal window=month"
    And `scopes` contains all 5 entries (org, team, project, virtual_key, principal)

  @bdd @phase-1b @principal-cascade @enforcement
  Scenario: PRINCIPAL budget is collected as a warning when on_breach=WARN
    Given alice has a $50/month PRINCIPAL budget on_breach=WARN with $42.00 spent
    When the gateway calls `budget.check` with projected cost $0.50 for alice
    Then the response `decision` is NOT "BLOCK" (no BLOCK-on_breach budget is in breach)
    And `warnings` contains a row with `scope: "principal"`, `pctUsed: 85`, `limitUsd: "50"`

  @bdd @phase-1b @principal-cascade @enforcement
  Scenario: Cascade with no PRINCIPAL budget does not synthesize one
    Given alice has NO PRINCIPAL budget
    And project "gateway-demo" has a $200/month PROJECT budget on_breach=BLOCK with $190.00 spent
    When the gateway calls `budget.check` with projected cost $11.00 for alice
    Then the response `decision` is "BLOCK"
    And `blockedBy` contains exactly one row with `scope: "project"`
    And `scopes` contains 4 entries (org, team, project, virtual_key) with NO principal entry

  # ============================================================================
  # Trace-fold attribution
  # ============================================================================

  @bdd @phase-1b @principal-cascade @trace-fold
  Scenario: Trace-fold map projection writes one ledger row per applicable budget INCLUDING PRINCIPAL
    Given alice has a $50/month PRINCIPAL budget
    And the org/team/project/VK budgets in the background apply
    When a finalised trace is processed for an alice-attributed request costing $0.42
    Then the trace-fold map projection writes 5 rows to `gateway_budget_ledger_events`
    And each row carries the same `GatewayRequestId` (idempotency key)
    And the PRINCIPAL row has `BudgetId` matching alice's principal budget and `SpendUSD = 0.42`

  # ============================================================================
  # Multi-scope VK — budget cascade with refactored VK shape
  # ============================================================================

  @bdd @phase-1b @principal-cascade @multi-scope-vk
  Scenario: Multi-scope VK (no PROJECT scope) routes budget.check with organizationId only
    Given a VirtualKey "vk_org_wide" scoped to ORGANIZATION "acme" (no team/project scope)
    And organization "acme" has a $1000/month ORG budget on_breach=BLOCK
    And NO team or project budget applies to this request path
    And alice has a $50/month PRINCIPAL budget
    When the gateway makes a request with "vk_org_wide" attributed to alice
    And calls `budget.check({ organizationId: "acme", teamId: null, projectId: null, virtualKeyId: "vk_org_wide", principalUserId: "user_alice", projectedCostUsd: "0.10" })`
    Then `scopes` contains 3 entries: org, virtual_key, principal (no team, no project)
    And the trace lands at org-level (no projectId claim on the JWT, see vk-config-bundle.feature)
    And the PRINCIPAL budget cascade still pivots correctly on principalUserId

  @bdd @phase-1b @principal-cascade @multi-scope-vk
  Scenario: VK scoped to multiple PROJECTs routes budget.check with no projectId (org-level trace)
    Given a VirtualKey "vk_multi_project" scoped to PROJECT "gateway-demo" AND PROJECT "ml-prod"
    When the gateway makes a request with "vk_multi_project"
    And calls `budget.check` with projectId=null (per the spec — VK has 2 project scopes)
    Then no per-project PROJECT budget is consulted in this cascade walk
    And the cascade still includes ORG / VK / PRINCIPAL (if present)
    And the trace lands at org-level
    # Documented consequence (also in vk-config-bundle.feature): per-project
    # trace search will not surface this VK's traces by design. Surfaced in
    # R3b docs sweep so users don't report it as a bug.

  @bdd @phase-1b @principal-cascade @multi-scope-vk
  Scenario: VK scoped to exactly one PROJECT routes per-project budget normally
    Given a VirtualKey "vk_single_project" scoped to PROJECT "gateway-demo" only
    And project "gateway-demo" has a $200/month PROJECT budget
    When the gateway makes a request with "vk_single_project"
    And calls `budget.check` with projectId="gateway-demo"
    Then the PROJECT budget is included in `scopes`
    And the trace's JWT carries `project_id="gateway-demo"`
    And per-project trace search surfaces these requests (the one-PROJECT-scope happy path)

  # ============================================================================
  # Group budgets ride the same cascade, one bucket per member
  # ============================================================================
  #
  # A group (GROUP-scoped) budget is the per-person tier expressed once:
  # "people in this group each get this much". It resolves through the same
  # principal machinery: one enforcement bucket per (budget, member), spend
  # stamped with the member, so an admin does not have to create and maintain
  # one PRINCIPAL budget per head, and a new joiner is covered without anyone
  # remembering to add them.

  @bdd @phase-1b @principal-cascade @group
  Scenario: A group budget resolves to the member's own bucket
    Given group "engineering" has a $50/month budget and alice is a member
    When alice's key is resolved
    Then the budget applies to alice
    And its spend accrues to alice alone, not to the group as a whole

  @bdd @phase-1b @principal-cascade @group
  Scenario: Two members of the same group do not share the allowance
    Given group "engineering" has a $50/month budget with alice and bob in it
    And alice has spent $49
    When bob makes a request
    Then bob is not blocked
    And alice's remaining allowance is unaffected by bob's spend

  @bdd @phase-1b @principal-cascade @group
  Scenario: Joining a group picks up its budget on the next resolve
    Given group "engineering" has a budget and carol is not a member
    When carol joins the group
    And her key's configuration is resolved again
    Then the group budget now applies to carol

  @bdd @phase-1b @principal-cascade @group
  Scenario: Leaving a group drops its budget
    Given carol is in group "engineering" which has a budget
    When carol leaves
    And her key's configuration is resolved again
    Then the group budget no longer applies to her
    And the spend she already recorded stays in the ledger

  @bdd @phase-1b @principal-cascade @group
  Scenario: A key with no person behind it is out of reach of group budgets
    Given group "engineering" has a budget
    When a shared service key with no principal is resolved
    Then no group budget applies to it
    # There is no member to charge the per-member allowance to.
