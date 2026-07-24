Feature: Bird's-eye governance dashboard v2 — graphs, Top-N framing, click-through, color-coded series
  The org-admin landing surface at "/governance" was originally a
  set of summary cards + flat top-5 spend tables. Customer-demo signal
  said the page must answer "how is the company adopting AI?" at a
  glance — outliers, trends, departments, model mix, growth — not
  just $totals. v2 adds:

    1. Bug fixes on the v1 surface (negative-second timestamps, always-
       100% trend artifact, orange-everywhere when there's no prior
       baseline).
    2. Explicit "Top N by spend" framing on every limited table + a
       "View all teams →" / "View all users →" link to a list page that
       supports sort + filter + pagination.
    3. Time-series spend-over-time stacked area (group-by team / user /
       model) so trend is visible at a glance.
    4. Spend-by-team-by-model stacked bar so customers see which models
       drive cost per department.
    5. Per-row click-through from the spend tables to a filtered
       /traces or activity-monitor detail view (so "click a team" is
       useful, not decorative).
    6. Stable name-hash colors (same algorithm ProjectAvatar uses) so
       a team's color in a row badge matches its color as a chart
       series throughout the dashboard.
    7. Honest empty / zero / no-baseline states.

  This is a v2 over the same `/governance` page (canonical Overview;
  `/settings/governance` is registered as a back-compat alias per
  `langwatch/src/routes.tsx` comment) — the v1
  shape continues to ship as a regression invariant for orgs that
  haven't seeded multi-team data yet.

  Pairs with:
    - specs/ai-gateway/governance/admin-oversight.feature  (v1 contract)
    - specs/ai-gateway/governance/activity-monitor.feature (data path)
    - specs/ai-gateway/governance/persona-home-content.feature (page wrap)

  Implementation lives under:
    - langwatch/src/pages/settings/governance.tsx                   (page)
    - langwatch/src/server/governance/activity-monitor/             (service)
    - langwatch/src/components/governance/charts/                   (Recharts wrappers — Phase B)
    - langwatch/src/utils/colorFromName.ts                          (Phase C util)

  Background:
    Given the user is signed in as an org admin of "acme-corp"
    And the governance preview flag is enabled for acme-corp
    And the org has activity from at least 4 teams across the last 60 days
    And the user is on "/governance"

  # ---------------------------------------------------------------------------
  # Axis 1 — Bug fixes on the v1 surface (Phase A)
  # ---------------------------------------------------------------------------

  @bdd @ui @birds-eye-v2 @phase-a @bug-fix
  Scenario: Last-active timestamp never renders a negative value
    Given a SpendByUser row whose lastActivity is "2026-05-05T14:32:01Z"
    And the page is rendered at "2026-05-05T14:32:00Z" (clock skew or
      seed timestamp clamped to now-1s)
    When the SpendByUser table renders
    Then the lastActivity cell renders "just now"
    And no row anywhere on the page renders a string starting with "-"
      followed by digits + "s ago" / "m ago" / "h ago" / "d ago"
    And the seed scripts under langwatch/scripts/ also clamp seeded
      OccurredAt to "now - 1s" minimum so re-seeding cannot reintroduce
      the bug

  @bdd @ui @birds-eye-v2 @phase-a @bug-fix
  Scenario: Trend cells show "—" when there is no prior-window baseline
    Given the org has spend in the current 30-day window
    And the org has zero spend in the prior 30-day window (e.g. fresh
      org, just-seeded, or genuinely first month of activity)
    When SpendByTeam / SpendByUser tables render
    Then the trend cell for every row renders a muted "—"
    And the cell does NOT render "↑ 100%" or any percentage
    And the cell does NOT render in the warning (orange) color

  # Fix shipped at 3f0f9a3ee (hasPriorBaseline guard applied to KPI summary
  # card identically to SpendByTeam / SpendByUser rows). No render test
  # currently asserts the "—" / "no prior data" mute path for the KPI card.
  # Pin @unimplemented until a Vitest snapshot covers the zero-prior branch.
  @bdd @ui @birds-eye-v2 @phase-a @bug-fix @regression @unimplemented
  Scenario: KPI summary card mutes its trend when prior window is zero
    Given the org has > 0 spend in the current window
    And the org has zero spend in the prior window
    When the KPI summary card renders at the top of /governance
    Then its trend label renders muted "—" / "no prior data"
    And the trend label does NOT render a percentage value
    And the trend label does NOT render an absurd percentage like
      "↑ 889058% vs previous" (regression — the v1 KPI summary
      bypassed Phase A's hasPriorBaseline mute path; caught during
      B-2 recapture; fixed by 3f0f9a3ee)
    And the same hasPriorBaseline guard is applied identically to
      every trend-displaying surface on the page (KPI summary card +
      SpendByTeam table + SpendByUser table + future v2 cards)

  # Cap fix shipped at 3f0f9a3ee. Render test for the >999% cap path on
  # TeamRow is pending — needs a fixture row where prior=$0 + current=>0.
  # Pin @unimplemented until the cap-rule snapshot lands.
  @bdd @ui @birds-eye-v2 @phase-a @bug-fix @regression @unimplemented
  Scenario: TeamRow caps absurd trend percentages
    Given a SpendByTeam row's computed trend would render at e.g.
      "↑ 253806%" (e.g. prior=$0.000001 vs current=$2.50)
    When the row renders
    Then the trend cell does NOT render a 6-digit percentage
    And the trend cell either caps the displayed value (e.g. ">999%")
      or falls back to the muted "—" treatment per the
      hasPriorBaseline rule
    And the cell does NOT render in the warning (orange) color when
      the underlying baseline is effectively zero (regression caught
      in B-2 recapture; fixed by 3f0f9a3ee)

  # Bucket math fix shipped at 4f776a56e (DateTime64 passed direct to
  # toStartOfDay, no ms-precision shift). Integration test for the
  # dense-bucket assertion is pending — needs a CH fixture with traces
  # spanning > 1 bucket. Pin @unimplemented until the CH integration test
  # backfill lands.
  @bdd @ch @birds-eye-v2 @phase-a @bug-fix @regression @unimplemented
  Scenario: spendOverTime CH bucket math operates on DateTime64 directly
    Given trace_summaries.OccurredAt is typed DateTime64(3, 'UTC')
    When the spendOverTime CH query bucketizes by day
    Then the query passes OccurredAt directly to toStartOfDay
      (matching the working pattern at activityMonitor.service spendByUser
      where toUnixTimestamp64Milli(max(occurredAt)) consumes the column
      directly)
    And the query does NOT divide by 1000 and re-wrap in toDateTime64
      (which would treat ms-precision ticks as seconds and double-shift
      every bucket out of window, causing bucket-key lookups to miss
      every row and points: [] to render despite live data — regression
      caught in B-2 recapture; fixed by 4f776a56e)
    And the dense-bucket integration test asserts at least one bucket
      contains populated points against the seeded fixture (anti-
      regression — a structurally-correct response with zero points
      anywhere must fail the test)

  @bdd @ui @birds-eye-v2 @phase-a @bug-fix
  Scenario: Trend cell only colors orange when actually anomalous
    Given a SpendByTeam row with current=$100 and prior=$80 (delta +25%)
    And another SpendByTeam row with current=$200 and prior=$80 (delta +150%)
    When the table renders
    Then the +25% row renders the trend cell in the neutral / default color
    And the +150% row renders the trend cell in the warning (orange) color
    And the threshold for warning color is documented in component
      props: orangeThreshold defaults to 25 (percent) — anything above
      that flips to orange, anything at-or-below stays neutral
    And a downward trend (e.g. -10%) renders in the success (green) or
      neutral color, never warning

  # ---------------------------------------------------------------------------
  # Axis 2 — Top-N framing + View-all link
  # ---------------------------------------------------------------------------

  @bdd @ui @birds-eye-v2 @top-n
  Scenario: SpendByTeam section is explicitly framed as "Top 5 by spend"
    When the SpendByTeam section renders
    Then the section header reads "Spend by team — Top 5 by spend"
      (or equivalent component-rendered string with "Top N" + the sort
      basis explicit)
    And below the table there is a "View all teams →" link
    And the link points to a route that lists every team with full
      sort + filter + pagination affordances (route lives at
      "/settings/governance/teams" or similar — see Axis 4)

  @bdd @ui @birds-eye-v2 @top-n
  Scenario: SpendByUser section is explicitly framed as "Top 10 by spend"
    When the SpendByUser section renders
    Then the section header reads "Spend by user — Top 10 by spend"
    And below the table there is a "View all users →" link
    And the link's destination route lists every user with sort + filter
      + pagination

  @bdd @ui @birds-eye-v2 @top-n @api
  Scenario: spendByTeam / spendByUser API supports pagination + sort
    When the page calls api.activityMonitor.spendByTeam with
      { organizationId, windowDays: 30, limit: 5, offset: 0,
        sortBy: "spend", sortDir: "desc" }
    Then the procedure returns at most 5 rows in spend-desc order
    And when called again with { ..., limit: 50, offset: 0 } from the
      "View all teams" page it returns the next page in the same
      ordering
    And sortBy supports at least: "spend", "requests", "lastActivity"
    And sortDir supports "asc" and "desc"
    And calls without those params (legacy callers) get the v1 default
      (top-50 by spend desc) — backwards-compatible

  # ---------------------------------------------------------------------------
  # Axis 3 — Time-series spend-over-time chart (Phase B)
  # ---------------------------------------------------------------------------

  @bdd @ui @birds-eye-v2 @charts @phase-b
  Scenario: Spend-over-time stacked-area chart renders by team
    Given the org has > 0 spend on at least 3 distinct teams over the
      last 30 days
    When the dashboard renders
    Then a "Spend over time — by team" chart renders above the
      SpendByTeam table
    And the chart is a Recharts <AreaChart> with stackId="1" applied
      to every series so areas accumulate per day-bucket
    And the X axis is daily date buckets across windowDays=30
    And the Y axis is USD spend
    And one stacked series exists per team that has non-zero spend in
      the window
    And the legend lists every team name
    And hovering a day shows a tooltip with per-team breakdown +
      total

  @bdd @ui @birds-eye-v2 @charts @phase-b @api
  Scenario: spendOverTime API contract
    When the page calls api.activityMonitor.spendOverTime with
      { organizationId, windowDays: 30, groupBy: "team" }
    Then the procedure returns
      { buckets: Array<{ bucketIso: string,
                         points: Array<{ key: string,
                                         label: string,
                                         spendUsd: number }> }> }
      (or the agreed envelope shape — exact wire shape locked at
      ship time, but it MUST round-trip a daily bucket × group-key
      cross-product)
    And buckets are daily (1d granularity at the CH query layer)
    And buckets cover the full requested window even if a bucket has
      zero spend (no gaps)
    And groupBy="user" returns per-user series
    And groupBy="model" returns per-model series

  @bdd @ui @birds-eye-v2 @charts @phase-b
  Scenario: Spend-over-time chart respects the group-by toggle
    Given the dashboard renders the spend-over-time chart
    When the user toggles group-by from "team" to "model"
    Then the chart re-renders with one stacked series per model
    And the legend swaps from team names to model names
    And the API is called again with groupBy="model"
    And the chart caches per-toggle results so toggling back does not
      re-fetch within a session

  @bdd @ui @birds-eye-v2 @charts @phase-b
  Scenario: Spend by team × model stacked-bar chart renders
    Given the org has > 0 spend on at least 3 teams across at least 2
      models in the window
    When the dashboard renders
    Then a "Spend by team × model" Recharts <BarChart> renders next to
      (or below) the spend-over-time chart
    And one bar per team is rendered along the X axis
    And each bar is stacked by model (one stack per model, summed
      spend per (team, model) cell)
    And the legend lists the models
    And the chart shares its color palette with the spend-over-time
      chart so a model's color is identical across both charts

  # ---------------------------------------------------------------------------
  # Axis 4 — Click-through + View-all routes
  # ---------------------------------------------------------------------------

  @bdd @ui @birds-eye-v2 @click-through
  Scenario: Clicking a team row drills into a filtered detail view
    Given the SpendByTeam table is rendered
    When the user clicks the row for team "engineering"
    Then the user is routed to a page scoped to that team — either:
      | option                         | route                                           |
      | A — dedicated team detail page | /settings/governance/teams/<teamId>            |
      | B — filtered traces view       | /traces?filter[teamId]=<teamId>                |
      | C — filtered activity-monitor  | /settings/activity-monitor?filter[teamId]=...  |
    And whichever option ships, the destination page renders that team's
      spend totals + recent activity + per-user breakdown for that team
    And the destination is consistent with the View-all link
      destination (i.e. View all teams + click-row-on-overview both
      land in the same surface family)

  @bdd @ui @birds-eye-v2 @click-through
  Scenario: View-all teams page supports sort + filter + pagination
    Given the user clicks "View all teams →"
    When the listing page renders
    Then every team in the org is listed (no Top-5 truncation)
    And the page exposes column-sort on at least: name, spend,
      requests, last-activity
    And the page exposes a free-text filter that matches team name
      substring
    And the page paginates with a configurable page size
    And the page shares its data source with the overview's
      SpendByTeam table (no second query shape) — both call
      api.activityMonitor.spendByTeam with different limit/offset args

  @bdd @ui @birds-eye-v2 @click-through
  Scenario: View-all users page mirrors the View-all teams contract
    Given the user clicks "View all users →"
    When the listing page renders
    Then every user with non-zero activity in the window is listed
    And the page exposes column-sort + free-text filter + pagination
    And the data source is api.activityMonitor.spendByUser with full
      pagination args

  # ---------------------------------------------------------------------------
  # Axis 5 — Color-derivation consistency (Phase C)
  # ---------------------------------------------------------------------------

  @bdd @ui @birds-eye-v2 @color
  Scenario: Team / user / model colors are derived from a name hash
    Given a team named "engineering"
    When the team's avatar bubble renders in the SpendByTeam table
    And the same team's series renders in the spend-over-time chart
    And the same team's stacked segment renders in the team × model bar
    Then all three surfaces show that team in the SAME color
    And the color is derived deterministically from the team name
      (same algorithm ProjectAvatar uses today via
       langwatch/src/utils/rotatingColors.ts → getColorForString)
    And a different team named "marketing" renders in a different
      color (palette spread is a function of the name, not row order)
    And renaming a team changes its color (acceptable trade-off — the
      name is the cache key)

  @bdd @ui @birds-eye-v2 @color
  Scenario: Color util is hoisted to a shared module
    Given Phase C ships
    Then a shared util exists at langwatch/src/utils/colorFromName.ts
      (or equivalent shared path) exporting at minimum:
        | export                  | shape                                |
        | colorFromName(name)     | (name: string) => string (CSS color) |
    And ProjectAvatar / RandomColorAvatar consume the same util
      (no duplicated palette logic)
    And the v2 dashboard's row badges + chart series + legend chips
      all consume the same util

  @bdd @ui @birds-eye-v2 @color
  Scenario: Color hash maintains contrast against light + dark surfaces
    Given the dashboard is viewed in light mode
    Then every name-hashed color renders against the light background
      with sufficient contrast (WCAG AA at minimum on text-bearing
      chips)
    And the same colors render acceptably in dark mode (palette is
      mode-aware OR all palette entries are mid-tone enough to work
      against both)

  # ---------------------------------------------------------------------------
  # Axis 6 — Empty / zero / no-baseline behaviors
  # ---------------------------------------------------------------------------

  @bdd @ui @birds-eye-v2 @empty-state
  Scenario: Fresh org with zero ingested events renders the v1 setup checklist
    Given the org has zero events in the last 30 days
    And the org has zero IngestionSources configured
    When the user lands on /governance
    Then the page renders the v1 "configure your first source"
      onboarding checklist (regression invariant — we do NOT show
      empty charts with $0 / blank legend)
    And the bird's-eye v2 charts + tables are NOT rendered until at
      least one event has landed in the activity stream

  @bdd @ui @birds-eye-v2 @empty-state
  Scenario: Org with current-window spend but zero prior-window spend
    Given the org has > 0 spend in the current 30-day window
    And the org has zero spend in the prior 30-day window
    When the dashboard renders
    Then the SpendByTeam / SpendByUser tables render
    And the trend cells render "—" not "↑ 100%" (per Axis 1)
    And the spend-over-time chart renders the current 30 days as
      stacked areas with the prior days as zero baseline (the chart
      still draws — empty days are valid data, not gaps)
    And no "no prior data" warning banner is rendered (the "—" trend
      cells communicate this honestly without scaring the user)

  @bdd @ui @birds-eye-v2 @empty-state
  Scenario: Single-team org renders charts honestly (no fake stacking)
    Given the org has activity from exactly one team
    When the dashboard renders
    Then the spend-over-time chart renders a single-color area
      (one series, not visually stacked)
    And the legend lists that one team
    And the team × model bar still renders if there are ≥ 2 distinct
      models, otherwise it renders a single-color bar per team
    And no error / empty-state replaces the chart — single-team is a
      valid, common shape

  @bdd @ui @birds-eye-v2 @empty-state
  Scenario: Anomaly card section renders muted "no anomalies" when empty
    Given the org has zero anomalies in the recent window
    When the dashboard renders
    Then the anomalies card renders a muted "No anomalies in the last
      24h" string
    And the card does NOT render in the warning (orange) color
    And the card is NOT replaced by an "empty state graphic" — the
      muted text is enough

  # ---------------------------------------------------------------------------
  # Performance + correctness invariants (cuts across all axes)
  # ---------------------------------------------------------------------------

  @bdd @ch @birds-eye-v2 @perf
  Scenario: spendOverTime CH query honors TenantId scoping
    Given two orgs each with non-overlapping spend
    When org A's admin loads /governance and the page calls
      spendOverTime
    Then the CH query has a WHERE clause beginning with
      "TenantId = {tenantId:String}"
    And the response contains zero rows derived from org B's events
    And no per-org scope leak is observable across the union of
      ALL groupBy values (team / user / model)

  @bdd @perf @birds-eye-v2
  Scenario: All bird's-eye queries return within budget on the live page
    Given an org with 60 days of activity across 10 teams + 50 users +
      8 models (representative seed shape)
    When the user lands on /governance
    Then summary + spendByTeam(top5) + spendByUser(top10) +
      ingestionSourcesHealth + recentAnomalies + spendOverTime(30d,
      groupBy=team) all complete within the page's loading budget
      (target: TTFB-to-render under 1.5s on warm CH cache)
    And the page does NOT issue per-row N+1 queries to resolve labels
      (team / user / model labels are joined or pre-resolved at the
      service layer)
