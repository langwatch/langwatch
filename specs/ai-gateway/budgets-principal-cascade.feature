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
  Scenario: Trace-fold reactor writes one ledger row per applicable budget INCLUDING PRINCIPAL
    Given alice has a $50/month PRINCIPAL budget
    And the org/team/project/VK budgets in the background apply
    When a finalised trace is processed for an alice-attributed request costing $0.42
    Then the trace-fold reactor writes 5 rows to `gateway_budget_ledger_events`
    And each row carries the same `GatewayRequestId` (idempotency key)
    And the PRINCIPAL row has `BudgetId` matching alice's principal budget and `SpendUSD = 0.42`
