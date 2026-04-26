Feature: AI Gateway Governance — My Usage personal dashboard
  As an enterprise developer using LangWatch-governed AI tools
  I want a personal dashboard at "/me" that shows my own AI usage, my spend,
  my budget, and a breakdown by tool/model/provider
  So that I can see what I'm spending, understand my own habits, and notice
  unusual usage before my admin does

  Per gateway.md "screen 6": the dashboard shows
    - top cards: spent this month / total requests this month / most-used model
    - line chart: spending over time (last 7-30 days)
    - bar chart by tool: Claude Code / Cursor / Codex CLI / Gemini CLI / etc.
    - recent activity list (last N requests with timestamp + tool + cost)
    - workspace switcher in header lets the user switch context to a team or project

  Background:
    Given user "jane@miro.com" is signed in to organization "miro"
    And jane has a personal team "Jane's Workspace" and personal project "personal-default"
    And jane has 1 personal VK with label "jane-laptop"
    And the workspace switcher is set to "My Workspace"

  # ---------------------------------------------------------------------------
  # Top-level cards
  # ---------------------------------------------------------------------------

  @bdd @ui @dashboard @cards
  Scenario: Three summary cards render at the top of the page
    When I navigate to "/me"
    Then I see three cards in a row:
      | card                  | shape                                              |
      | Spent this month      | dollar amount + "of $X budget" if budget is set    |
      | Requests this month   | integer + "↑ N% vs last month" delta when ≥7d data |
      | Most-used model       | model name + "N% of usage"                         |
    And each card pulls data from `user.personalContext` + cost-aggregation tRPC
    And when the personal project has zero traces, each card renders an empty state hint

  # ---------------------------------------------------------------------------
  # Spending over time
  # ---------------------------------------------------------------------------

  @bdd @ui @dashboard @charts
  Scenario: Spending-over-time chart shows last 30 days bucketed daily
    Given the personal project has traces with cost on the last 14 days
    When I navigate to "/me"
    Then I see a "Spending over time" line chart
    And the x-axis spans the last 30 days
    And the y-axis shows USD per day
    And data buckets are sourced from the same trace cost pipeline as project usage charts
    And mousing over a bar shows the exact dollar amount and date

  @bdd @ui @dashboard @charts @empty
  Scenario: Spending-over-time chart shows an empty state with onboarding hint
    Given the personal project has no traces
    When I navigate to "/me"
    Then the chart area shows "No usage yet — run `langwatch claude` to get started"
    And the empty state links to a copy-pasteable CLI install snippet

  # ---------------------------------------------------------------------------
  # By tool / by model breakdown
  # ---------------------------------------------------------------------------

  @bdd @ui @dashboard @breakdown
  Scenario: By-tool breakdown shows tool inferred from User-Agent / OTel attribute
    Given the personal project has traces from:
      | tool         | spend  |
      | Claude Code  | $31.40 |
      | Cursor       | $ 8.22 |
      | Codex CLI    | $ 2.56 |
    When I navigate to "/me"
    Then I see a "By tool" horizontal bar list with each tool, a bar proportional to its share, and the dollar amount
    And the tool is inferred from the request's User-Agent and/or OTel `langwatch.client.name` attribute
    And tools without an identifiable User-Agent are bucketed under "Other / API"

  @bdd @ui @dashboard @breakdown
  Scenario: By-model breakdown is available as a toggle next to "By tool"
    Given the personal project has spend across 4 models
    When I toggle the breakdown view to "By model"
    Then the chart re-renders with model names on each row
    And totals match the per-model cost from the trace pipeline

  # ---------------------------------------------------------------------------
  # Recent activity
  # ---------------------------------------------------------------------------

  @bdd @ui @dashboard @recent
  Scenario: Recent activity list shows the last 10 requests with cost
    When I navigate to "/me"
    Then I see a "Recent activity" section
    And it shows the last 10 traces from the personal project
    And each row contains: timestamp, tool name, short summary (first line of input), cost
    And clicking a row navigates to the trace detail page (existing route)
    And a "View all →" link goes to the personal project's traces page

  # ---------------------------------------------------------------------------
  # Workspace switcher integration
  # ---------------------------------------------------------------------------

  @bdd @ui @dashboard @workspace-switcher
  Scenario: Switching workspace context away from "My Workspace" navigates away from /me
    Given I am on "/me" with the workspace switcher set to "My Workspace"
    When I open the workspace switcher and pick team "Sales Engineering"
    Then I am navigated to the team's overview page (or dashboard route)
    And the workspace switcher chip in the header shows "Sales Engineering"

  @bdd @ui @dashboard @workspace-switcher @return
  Scenario: Switching back to "My Workspace" returns the user to /me
    Given I am on a team or project page with the switcher pointing at it
    When I open the workspace switcher and pick "My Workspace"
    Then I am navigated to "/me"

  # ---------------------------------------------------------------------------
  # Authorization
  # ---------------------------------------------------------------------------

  @bdd @ui @dashboard @authz
  Scenario: A logged-out user hitting /me is redirected to login
    Given there is no active session
    When I navigate to "/me"
    Then I am redirected to the login page

  @bdd @ui @dashboard @authz
  Scenario: One user cannot view another user's /me page directly
    Given the API has `user.personalContext` keyed by current session
    When jane@miro.com is signed in and navigates to "/me"
    Then she only sees her own personal team / project / VKs / spend
    And there is no URL parameter that would let her render someone else's /me

  # ---------------------------------------------------------------------------
  # Performance
  # ---------------------------------------------------------------------------

  @bdd @ui @dashboard @perf
  Scenario: /me dashboard P95 server-side render is under 500ms for a user with ≤10k traces
    Given the personal project has 10000 traces in the last 30 days
    When I cold-load "/me"
    Then the server renders the page in ≤500ms P95
    And client-side hydration adds ≤200ms before charts paint
    And no charts block on an aggregation that fans out across multiple ClickHouse tenants
