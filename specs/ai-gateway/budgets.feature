Feature: AI Gateway — Budgets
  As an admin governing AI spend
  I want to set budgets that scope to organizations, teams, projects, virtual keys, or principals
  So that I can prevent runaway costs and route spending per unit of work

  Budgets are hierarchical. A single request is checked against every budget that
  applies (its org, its team, its project, its virtual key, its principal). Any
  budget in breach blocks the request when its on_breach is "block", or lets it
  through with a warning header when its on_breach is "warn". Spend is debited
  asynchronously after a response using provider-computed token counts, using an
  outbox keyed by gateway_request_id for at-least-once idempotency.

  Background:
    Given organization "acme" exists with team "platform" and project "gateway-demo"
    And project "gateway-demo" has an active virtual key "prod-key"
    And I have "gatewayBudgets:manage" permission on organization "acme"

  # ============================================================================
  # Budget creation and scoping
  # ============================================================================

  @integration
  Scenario: Create a project-scope monthly budget
    When I open the "AI Gateway → Budgets" section
    And I click "New budget"
    And I enter name "demo-month"
    And I select scope "project" with target "gateway-demo"
    And I select window "month"
    And I enter limit "500" USD
    And I select on_breach "block"
    And I click "Create"
    Then the budget is persisted
    And it appears under project "gateway-demo" with reset date set to the next month-start

  @integration
  Scenario: Budget scopes supported
    When I open the "new budget" drawer
    Then the scope field offers: org, team, project, virtual_key, principal
    And the window field offers: minute, hour, day, week, month, total
    And the on_breach field offers: block, warn

  # ============================================================================
  # Enforcement — pre-request gate
  # ============================================================================

  @integration
  Scenario: Hard-block budget returns 402 when spent >= limit
    Given project "gateway-demo" has a monthly budget with limit $100 and on_breach "block"
    And 99.50 USD of spend has been attributed to this project this month
    When a gateway request is estimated to cost $2
    Then the gateway rejects the request with 402
    And the error envelope is { error: { type: "budget_exceeded", code: "budget.project.exceeded", ... } }
    And no upstream provider is called

  @integration
  Scenario: Soft budget emits warning header but allows the call
    Given project "gateway-demo" has a monthly budget with limit $100 and on_breach "warn"
    And 95.00 USD of spend has been attributed this month
    When a gateway request is processed
    Then the upstream provider is called
    And the response includes header "X-LangWatch-Budget-Warning: project:95%"
    And the response body is the provider's response unchanged

  @integration
  Scenario: Most restrictive budget wins when multiple apply
    Given virtual key "prod-key" has limit $10 (block) for today
    And its project has limit $1000 (block) for today
    And its org has limit $100000 (block) for today
    And 9.90 USD has already been spent via "prod-key" today
    When a gateway request is estimated to cost $1
    Then the request is blocked with scope "virtual_key"
    And the error code indicates which scope was exceeded

  @integration
  Scenario: Sum-of-breaches rule — any block-breach blocks
    Given project has limit $10 (warn) for today, 9.99 spent
    And its virtual key has limit $100 (block) for today, 99 spent
    When a gateway request is estimated to cost $2
    Then the request is blocked because vk-block breaches, even though project is only warn

  # ============================================================================
  # Ledger — idempotent async debit from the outbox
  # ============================================================================

  @integration
  Scenario: POST /internal/gateway/budget-debit is idempotent
    Given a gateway_request_id "grq_01H..." is unseen
    When the gateway posts a debit { gateway_request_id: "grq_01H...", amount_usd: 0.42, tokens: {...} }
    Then the ledger records one entry and returns { spent_usd, remaining_usd } per applicable scope
    When the gateway retries the same gateway_request_id later
    Then the ledger does NOT double-count
    And the response returns the same { spent_usd, remaining_usd } as the first call

  @integration
  Scenario: Outbox retries at-least-once when LangWatch is briefly unreachable
    Given the LangWatch app is unreachable for 30 seconds during a gateway request
    When the gateway buffers the debit in its outbox
    And LangWatch becomes reachable again
    Then the buffered debit is POSTed to /internal/gateway/budget-debit
    And the ledger records the spend (idempotent by gateway_request_id)

  @integration
  Scenario: Cost attribution uses provider-reported tokens, not estimates
    Given a gateway request completes with provider-reported usage
      { prompt_tokens: 1000, completion_tokens: 500 }
    And the gateway has the current cost-per-token for the resolved model
    When the ledger entry is computed
    Then the debit amount_usd is derived from actual tokens × unit cost
    And the estimate is discarded

  # ============================================================================
  # Window resets
  # ============================================================================

  @integration
  Scenario: Monthly budget resets at month start
    Given project has limit $100 for window "month" with last reset on 2026-04-01T00:00Z
    When the wall clock crosses 2026-05-01T00:00Z
    Then the ledger's "spent_usd" for this budget is set to 0
    And the next_reset_at is advanced to 2026-06-01T00:00Z
    And a "budget.window.reset" event is recorded

  @integration
  Scenario: Daily and weekly windows honor org-configured timezone
    Given organization "acme" has timezone "Europe/Amsterdam"
    When the daily budget resets
    Then the reset fires at 00:00 Europe/Amsterdam, not UTC

  # ============================================================================
  # Dashboard and spend visibility
  # ============================================================================

  @visual
  Scenario: Budget detail drawer shows current spend, projection, and top consumers
    Given a monthly budget "demo-month" is 60% spent
    When I open the budget detail drawer
    Then I see current spend, limit, projection to end of window,
      top 5 virtual keys by spend, top 5 models by spend,
      and a reset countdown

  @visual
  Scenario: Running close to hard cap surfaces a banner
    Given a budget is ≥ 90% spent with on_breach "block"
    When I am on any AI Gateway screen
    Then I see a warning banner "project/gateway-demo — monthly budget at 92%"
    And the banner links to the budget detail drawer

  # ============================================================================
  # Permissions (RBAC)
  # ============================================================================

  @integration
  Scenario: Only users with gatewayBudgets:manage can create or edit
    Given I am a Member with gatewayBudgets:view but not gatewayBudgets:manage
    When I open the Budgets section
    Then the "New budget" button is disabled
    And the API rejects creation with "forbidden"

  @integration
  Scenario: Viewing your own spend requires gatewayBudgets:view
    Given I am a Viewer with no gatewayBudgets:* permissions
    When I open the AI Gateway section
    Then the "Budgets" nav item is hidden
    And direct URL access returns a 403 page with a "request access" link
