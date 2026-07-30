Feature: AI Gateway — Budgets

  # Four scenarios below are bound to budget.service.unit.test.ts. The
  # remaining @unimplemented scenarios are split between two unbindable
  # categories: (1) gateway data-plane behaviour (HTTP 402 on debit,
  # /budget/check materialised view, ClickHouse ledger map projection, monthly
  # window reset, timezone handling) — implemented in Go and out of
  # scope for the TS parity check; and (2) UI page-level rendering
  # (budget detail drawer, banners, list columns, audit history) — needs
  # component-test fixtures against the Gateway settings pages. All
  # aspirational pending those harnesses.

  As an admin governing AI spend
  I want to set budgets that scope to organizations, teams, projects, virtual keys, or principals
  So that I can prevent runaway costs and route spending per unit of work

  Budgets are hierarchical. A single request is checked against every budget that
  applies (its org, its team, its project, its virtual key, its principal). Any
  budget in breach blocks the request when its on_breach is "block", or lets it
  through with a warning header when its on_breach is "warn".

  A budget that is close to its limit but not yet in breach warns without
  blocking anything. The threshold is 80% of the limit, the same point at which
  the dashboard banner and the CLI warning appear, so a customer never sees one
  surface warn while another stays quiet. The warning rides on the response as
  "X-LangWatch-Budget-Warning: <scope>:<pct>", one entry per budget over the
  threshold, comma-separated when several apply. It is present on both
  streaming and non-streaming responses, and on responses long enough that the
  gateway has already started sending keep-alive bytes. Budgets that are only
  approaching a hard cap warn too: the request still succeeds, and the header is
  the only notice before the 402 starts.

  Spend is derived from traces. The gateway emits one OTel span per request
  carrying gen_ai.usage.* + langwatch.virtual_key_id + langwatch.gateway_request_id.
  The trace-processing pipeline enriches the span with cost (pricing catalog ×
  tokens), and a dedicated map projection writes one row per applicable budget to
  gateway_budget_ledger_events in ClickHouse. An AggregatingMergeTree
  materialised view (gateway_budget_scope_totals) rolls up spend per (scope,
  scope_id, window, period_start). /budget/check reads from the materialised
  view using sumMerge. There is no separate debit endpoint — the OTel trace
  itself IS the debit signal. Idempotency is guaranteed by the ReplacingMergeTree
  ORDER BY (TenantId, BudgetId, GatewayRequestId).

  Background:
    Given organization "acme" exists with team "platform" and project "gateway-demo"
    And project "gateway-demo" has an active virtual key "prod-key"
    And I have "gatewayBudgets:manage" permission on organization "acme"

  # ============================================================================
  # Budget creation and scoping
  # ============================================================================

  @integration @unimplemented
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

  @integration @unimplemented
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
    And the response includes header "X-LangWatch-Budget-Warning: project:95"
    And the response body is the provider's response unchanged

  @integration
  Scenario: Streaming responses carry the warning header too
    Given project "gateway-demo" has a monthly budget with limit $100 and on_breach "warn"
    And 95.00 USD of spend has been attributed this month
    When a gateway request is processed with streaming enabled
    Then the response includes header "X-LangWatch-Budget-Warning: project:95"
    And the stream is the provider's stream unchanged

  @integration
  Scenario: A hard cap warns on approach before it starts rejecting
    Given project "gateway-demo" has a monthly budget with limit $100 and on_breach "block"
    And 85.86 USD of spend has been attributed this month
    When a gateway request is processed
    Then the upstream provider is called
    And the response includes header "X-LangWatch-Budget-Warning: project:85"

  @integration
  Scenario: No warning header well under the limit
    Given project "gateway-demo" has a monthly budget with limit $100 and on_breach "block"
    And 40.00 USD of spend has been attributed this month
    When a gateway request is processed
    Then the response carries no budget warning header

  @integration
  Scenario: A long-running completion still reports the warning
    Given project "gateway-demo" has a monthly budget with limit $100 and on_breach "warn"
    And 95.00 USD of spend has been attributed this month
    When a gateway request takes long enough for the gateway to send keep-alive bytes
    Then the response includes header "X-LangWatch-Budget-Warning: project:95"
    And the gateway request id header is present as well

  @integration
  Scenario: Every applicable budget over the threshold is named
    Given the organization is at 84% of its monthly limit with on_breach "block"
    And the project is at 20% of its daily limit with on_breach "block"
    And virtual key "prod-key" is at 99% of its daily limit with on_breach "warn"
    When a gateway request is processed
    Then the response includes header "X-LangWatch-Budget-Warning: organization:84,virtual_key:99"

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
  # Ledger — trace-driven fold in ClickHouse
  # ============================================================================

  @integration @unimplemented
  Scenario: Gateway trace lands one row per applicable budget in ClickHouse
    Given a gateway request is completed with gateway_request_id "grq_01H..."
    And the emitted span carries langwatch.virtual_key_id, gen_ai.usage.input_tokens,
      gen_ai.usage.output_tokens, and a resolved gen_ai.request.model
    And the project has three applicable budgets: org-monthly, team-monthly, project-daily
    When the trace lands in ClickHouse and the gatewayBudgetSync map projection runs
    Then gateway_budget_ledger_events has three rows keyed by
      (TenantId, BudgetId, GatewayRequestId)
    And each row's AmountUSD equals the enriched cost for the span
    And gateway_budget_scope_totals reflects the increment under the matching PeriodStart

  @integration @unimplemented
  Scenario: Trace replay does not double-count spend (idempotency by gateway_request_id)
    Given a trace with gateway_request_id "grq_01H..." has already produced a debit row
    When the same trace is re-ingested (OTel replay, retry, or dev replay tooling)
    Then gateway_budget_ledger_events collapses the duplicate via ReplacingMergeTree
    And gateway_budget_scope_totals does NOT double-count the spend

  @integration @unimplemented
  Scenario: Cost attribution uses provider-reported tokens × pricing catalog
    Given a gateway request completes with provider-reported usage
      { prompt_tokens: 1000, completion_tokens: 500 }
    And the control plane's pricing catalog has per-token costs for the resolved model
    When the span is enriched and the map projection writes to gateway_budget_ledger_events
    Then AmountUSD is derived from provider tokens × unit cost
    And the gateway's pre-request cost estimate is used only for pre-flight
      budget-check gating, never for the ledger

  @integration @unimplemented
  Scenario: /budget/check reads from the CH materialised view
    Given project "gateway-demo" has a monthly budget with limit $100
    And 42.00 USD of spend has been attributed to this project this month via traces
    When the gateway calls POST /api/internal/gateway/budget/check
    Then the response is derived from sumMerge(SpendUSD) on gateway_budget_scope_totals
      bounded to the current month's PeriodStart
    And the response returns { spent_usd: "42.00", remaining_usd: "58.00" }
    And no Postgres gatewayBudgetLedger row is read

  # ============================================================================
  # Spend must survive the thing that recorded it
  # ============================================================================
  #
  # The scenarios above cover spend being counted ONCE (idempotency by
  # gateway_request_id). These cover it being counted AT ALL.
  #
  # Debits used to be written by `gatewayBudgetSync`, a reactor, and the
  # projection router never dispatches a reactor on the replay path — the
  # replay service rebuilds projections and never invokes a reactor at all. So
  # a debit lost to a failed handler was lost permanently: the spend happened,
  # the gateway trace recorded it, and the budget never learned. The same
  # handler emitted the BUDGET_UPDATED change the gateway consumes to evict
  # cached bundles, so losing it also left the gateway authorising against
  # stale spend. Both failures moved measured spend DOWN, the dangerous
  # direction for a control whose job is to stop spending.
  #
  # ADR-075 (Class C) has since converted the write to a map projection over
  # gateway spans. A failed write now propagates instead of being swallowed, so
  # the job retries; and because the debit is derived rather than emitted, a
  # replay of the window re-derives whatever the retries never landed, and
  # announces only what it actually repaired.
  #
  # What still does not exist is the reconciliation REPORT — recomputing a
  # period's spend from its traces and naming the debits that are missing — and
  # the restart path where the gateway is left holding a cached view no
  # surviving process will correct. Those two stay @unimplemented.

  @integration
  Scenario: Spend recorded during a failure still counts against the budget
    Given a gateway request that consumed budget
    When the work recording that debit fails
    Then the debit is recorded once the failure clears
    And the budget reflects it

  @integration @unimplemented
  Scenario: Total spend can be reconciled against the traces that produced it
    Given a period of gateway requests that consumed budget
    When spend for that period is recomputed from the recorded gateway traces
    Then it matches the spend the budget was charged
    And any debit missing from the ledger is reported

  @integration @unimplemented
  Scenario: The gateway stops serving on stale spend after a restart
    Given spend recorded while the gateway held a cached view of the budget
    When the process that would have notified the gateway dies first
    Then the gateway still stops authorising once the budget is exhausted

  # ============================================================================
  # Spend must read back for every window offered
  # ============================================================================
  #
  # Spend is written to the ledger by the trace fold and read back from the
  # pre-aggregated rollup. The two sides bucket spend into periods, and they
  # only ever agree if they compute the start of the period the same way. When
  # they disagree the write lands in a bucket the read never looks at, so a
  # budget accrues nothing forever, blocks nothing, and warns about nothing,
  # while the UI reports a confident zero.

  @integration
  Scenario Outline: Spend recorded against a budget is visible on that budget
    Given a budget with window "<window>" and limit $0.0001
    When $0.001 of spend is recorded against it
    Then the budget reports non-zero spend
    And it reports itself as over its limit

    Examples:
      | window |
      | minute |
      | hour   |
      | day    |
      | week   |
      | month  |
      | total  |

  # The ledger's OccurredAt column carries no timezone, so the rollup's
  # period truncation follows the ClickHouse server timezone unless the
  # view pins one. The reader always computes period starts in UTC. On a
  # server whose default timezone is not UTC, an unpinned view buckets
  # DAY, WEEK, and MONTH spend at local midnight while the reader asks
  # for UTC midnight: the same never-readable-bucket failure, reachable
  # by deployment configuration instead of code drift.
  @integration
  Scenario: Spend stays visible when the ClickHouse server does not run in UTC
    Given the underlying spend store computes period boundaries in its own local timezone
    And a budget for each of the day, week, and month windows
    When spend is recorded against each budget
    Then each budget reports non-zero spend

  # Period boundaries are part of the rollup's key, and the rollup is what
  # every read and every enforcement decision consults. When the key moves
  # to UTC boundaries, spend already recorded under local boundaries must
  # be carried across by rebuilding the rollup from the ledger, which keeps
  # every debit. Otherwise an org that spent $800 of a $1000 monthly budget
  # before the upgrade would read $0 after it and sail past its cap.
  @integration
  Scenario: Spend recorded before the rollup rebuild still counts after it
    Given the underlying spend store computes period boundaries in its own local timezone
    And day, week, and month budgets already carry recorded spend
    When the deployment is upgraded to compute period boundaries in UTC
    Then each budget reports exactly the spend recorded before the rebuild
    And spend recorded on boundaries that were already UTC is unchanged
    And a budget blocks when spend recorded before and after the rebuild together pass its limit

  @integration
  Scenario: A blocking budget blocks once its recorded spend passes the limit
    Given project "gateway-demo" has a blocking budget of $0.0001 for today
    When enough gateway traffic is recorded to pass $0.0001
    Then a further request through "prod-key" is refused for going over budget
    And the refusal names the budget that was exceeded

  @integration
  Scenario: A blocking budget warns before it blocks
    Given project "gateway-demo" has a blocking budget of $0.0001 for today
    When recorded spend reaches 80% of the limit but has not passed it
    Then a request through "prod-key" still reaches the provider
    And the response carries a budget warning

  # ============================================================================
  # Provider-filtered budgets
  # ============================================================================
  #
  # A budget can name a provider, in which case it counts and constrains only
  # what is dispatched to that provider. Because it constrains one vendor
  # rather than the whole request, a breach removes that vendor from the
  # candidates rather than refusing the call: with somewhere else to go the
  # request is served, and only when nothing is left does it fail, naming
  # the budget that emptied the list.

  @integration
  Scenario: A breached provider-filtered budget takes that provider out of the running
    Given a key that can reach two providers
    And a blocking budget on one of them that is over its limit
    When a request arrives that either provider could serve
    Then the request is served by the other provider
    And no budget-exceeded error is returned

  @integration
  Scenario: A request with nowhere left to go is refused and says why
    Given a key whose only usable provider has a breached blocking budget
    When a request arrives
    Then the request is refused for going over budget
    And the refusal names the budget that ran out

  @integration
  Scenario: A warning-only provider budget lets the provider keep serving
    Given a key that can reach one provider
    And a warning budget on that provider that is over its limit
    When a request arrives
    Then the provider still serves it
    And the response carries a budget warning naming that budget

  @integration
  Scenario: Spend is attributed to the provider that actually served the request
    Given a budget that counts one provider only
    And a budget on the same target that counts every provider
    When a request is served by a different provider
    Then only the unfiltered budget's spend goes up
    # The debit records the provider it was dispatched to, so a filtered
    # budget accrues its own spend and nobody else's.

  # ============================================================================
  # Where spend is read from
  # ============================================================================
  #
  # Spend per key is read from the trace cost path, not from the budget
  # ledger. The ledger exists per budget: it is written once per applicable
  # budget, and not at all for a key nobody has capped. Reading a key's spend
  # from it reported $0.00 for every uncapped key and multiplied the spend of
  # every key covered more than once, and those are exactly the numbers the
  # keys table shows and the Usage tab has to agree with.

  @integration
  Scenario: A key with no budget still reports what it spent
    Given a virtual key with no budget of any kind covering it
    When it is used and the traffic has been processed
    Then its spend is visible on the key
    And it is visible on the Usage tab

  @integration
  Scenario: A key covered by several budgets is not counted once per budget
    Given a virtual key covered by an organization budget and a project budget
    When it makes one request costing a known amount
    Then its reported spend is that amount, not a multiple of it

  @integration
  Scenario: Spend from minutes ago is inside the window the page asks for
    Given a request made a minute ago
    When the last 30 days are requested
    Then that request is included
    # The pages ask for a rolling window ending now, not a window ending at
    # the last complete day. Spend does not wait for a day boundary.

  @integration
  Scenario: The window start is inclusive and the window end is exclusive
    Given a request made at a known instant
    When a window starting at exactly that instant is requested
    Then the request is included
    And a window ending at exactly that instant excludes it

  @integration
  Scenario: A re-projected trace is counted once, at its latest cost
    Given a trace whose cost was written once and then corrected
    When spend is read before the two writes have been merged
    Then the trace counts once, at the corrected cost

  @unit
  Scenario: A usage page left open keeps asking for a window that ends now
    Given the usage page is open showing the last 30 days
    When a day passes without the page being reloaded
    Then the window it asks for still ends now
    # A window frozen at page load is how a dashboard left open overnight
    # ends up a day behind: the spend arrived, the page just stopped asking
    # for it.

  @unit
  Scenario: The window keeps its length as it rolls
    Given the usage page is showing the last 7 days
    When the window rolls forward
    Then it is still 7 days wide

  @integration
  Scenario: Spend is reported per key with its own daily and model split
    Given a key with traffic across models
    When its usage is requested
    Then the total, the per-day split and the per-model split all come from the same source
    # A total that disagrees with its own breakdown is worse than either.

  # ============================================================================
  # Making a budget that cannot work visible
  # ============================================================================

  @integration
  Scenario: A budget whose spend cannot be totalled says so instead of showing zero
    Given a budget exists
    But spend totals cannot be read right now
    When I open the Budgets list
    Then the budget does not claim "$0.00 spent, 0% of limit"
    And it tells me its spend is unavailable

  @visual
  Scenario: The Budgets screen surfaces that spend is not being totalled
    Given spend totals cannot be read right now
    When I open the Budgets list
    Then a notice tells me spend figures are unavailable and budgets are not being enforced

  @integration
  Scenario: A budget warns when no key can ever spend against it
    Given project "gateway-demo" has a budget scoped to project "gateway-demo"
    But every active key in the organization is scoped to team "platform"
    When I open the Budgets list
    Then the budget warns that no active key sends traffic it can see
    And the warning names which scopes the organization's keys actually use

  @integration
  Scenario: A budget that some key can spend against carries no warning
    Given project "gateway-demo" has a budget scoped to project "gateway-demo"
    And an active key is scoped to project "gateway-demo"
    When I open the Budgets list
    Then the budget carries no scope warning

  # ============================================================================
  # Window resets
  # ============================================================================

  @integration @unimplemented
  Scenario: Monthly budget resets at month start
    Given project has limit $100 for window "month" with last reset on 2026-04-01T00:00Z
    When the wall clock crosses 2026-05-01T00:00Z
    Then the ledger's "spent_usd" for this budget is set to 0
    And the next_reset_at is advanced to 2026-06-01T00:00Z
    And a "budget.window.reset" event is recorded

  @integration @unimplemented
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
  Scenario: Budget list Scope column resolves target name with VK link
    Given budgets exist scoped to "organization acme-demo", "team platform",
      "project gateway-demo", "virtual_key prod-openai", and "principal user@acme.com"
    When I open the Budgets list
    Then each row's Scope cell shows the scope-kind badge on top
    And the scope-target name below (e.g. "acme-demo", "platform", "gateway-demo")
    And VK-scope rows link to the VK detail page via an orange link
    And a muted-parenthesised secondary (slug / displayPrefix / email) follows the name

  @visual
  Scenario: Budget detail header surfaces Audit history even after archive
    Given budget "demo-month" was archived yesterday
    When I open its detail page
    Then Edit and Archive buttons are hidden (archived — actions are no-op)
    But the "Audit history" button is still visible and deep-links to
      /settings/audit-log?targetKind=budget&targetId=budget_…

  @visual
  Scenario: Budget detail Recent debits humanises When + Amount columns
    Given budget "demo-month" has 300+ ledger debits across the last 30 days
    When I open the detail page and scroll to "Recent debits"
    Then the When column shows "3h ago" / "2d ago" with exact timestamp on hover
    And the Amount column uses smart decimals — 4 places for ≥$1, 5 for 1¢-$1, 6 below 1¢
    And the Status column uses colored badges (green success, orange provider_error, red blocked)

  @visual
  Scenario: Running close to hard cap surfaces a banner
    Given a budget is ≥ 90% spent with on_breach "block"
    When I am on any AI Gateway screen
    Then I see a warning banner "project/gateway-demo — monthly budget at 92%"
    And the banner links to the budget detail drawer

  # ============================================================================
  # Permissions (RBAC)
  # ============================================================================

  @integration @unimplemented
  Scenario: Only users with gatewayBudgets:manage can create or edit
    Given I am a Member with gatewayBudgets:view but not gatewayBudgets:manage
    When I open the Budgets section
    Then the "New budget" button is disabled
    And the API rejects creation with "forbidden"

  @integration @unimplemented
  Scenario: Viewing your own spend requires gatewayBudgets:view
    Given I am a Viewer with no gatewayBudgets:* permissions
    When I open the AI Gateway section
    Then the "Budgets" nav item is hidden
    And direct URL access returns a 403 page with a "request access" link
