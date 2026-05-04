Feature: Persona-aware home CONTENT — what each persona sees on landing
  As LangWatch becomes both an LLMOps observability platform AND an AI Governance
  platform, the home page each persona lands on must SHOW the right content for
  their role. The destination (which URL to land on) is solved by
  `PersonaResolverService` + `persona-home-resolver.feature`. The chrome
  (sidebar/header) is solved by `persona-aware-chrome.feature`. This spec locks
  down the BODY CONTENT of each home, plus a two-tier customization knob.

  Per gateway.md Screen 6 + rchaves directive 2026-05-04 ("most current LangWatch
  customers are LLMOps admins NOT using the AI Gateway — must NOT see governance
  view directly"):
    - Persona 3 (LLMOps majority) home content stays UNCHANGED — regression
      invariant.
    - Personas 1, 2, 4 each get their own home shape.
    - Users can pin their default landing via `/me/settings`.
    - Org admins can pin a default for all members via `/settings/general`
      (Organization.defaultLandingPath — proposed for follow-up PR; this spec
      includes scenarios so the contract is locked).

  Pairs with:
    - specs/ai-gateway/governance/persona-home-resolver.feature  (destination)
    - specs/ai-gateway/governance/persona-aware-chrome.feature   (sidebar/header)
    - specs/ai-gateway/governance/architecture-invariants.feature (data path)
    - .monitor-logs/lane-a-persona-home-content-proposal.md      (rationale)

  Background:
    Given the four canonical personas:
      | persona            | destination               |
      | personal_only      | /me                       |
      | mixed              | /me                       |
      | project_only       | /[project]/messages       |
      | governance_admin   | /settings/governance      |
    And resolution is via `governance.resolveHome` tRPC

  # ---------------------------------------------------------------------------
  # Persona 1 — personal_only — /me with AiToolsPortal + personal usage
  # ---------------------------------------------------------------------------

  @bdd @ui @persona-content @persona-1
  Scenario: Personal-only home renders the AI tools portal + personal usage
    Given a user resolves to persona "personal_only"
    When the user navigates to "/"
    Then they are redirected to "/me"
    And the body renders, in order:
      | section            | required               |
      | Welcome eyebrow    | "Welcome back, <name>" |
      | AiToolsPortal      | tile grid              |
      | Summary cards      | Spent / Reqs / Top-model |
      | Spending over time | 14d daily-bucket chart |
      | Recent activity    | last 10 wrapper calls  |
    And NO "Your projects" section is rendered (no project memberships)
    And NO project-scoped CTAs surface

  @bdd @ui @persona-content @persona-1 @empty-state
  Scenario: Personal-only home renders an honest empty state when no usage yet
    Given a user resolves to persona "personal_only"
    And the user has zero wrapper invocations on record
    When the user lands on "/me"
    Then "Spending over time" renders an EmptyState with hint
      "Run `langwatch claude` to get started"
    And "Recent activity" renders "No requests yet"
    And the AiToolsPortal still surfaces all org-allowed tool tiles

  # ---------------------------------------------------------------------------
  # Persona 2 — mixed — /me with personal + projects + cross-project activity
  # ---------------------------------------------------------------------------

  @bdd @ui @persona-content @persona-2 @gap
  Scenario: Mixed-persona home additionally renders projects + recent project activity
    Given a user resolves to persona "mixed"
    And the user is a member of at least one project (ProjectMember row)
    When the user lands on "/me"
    Then the body renders, in order:
      | section              | required                              |
      | Welcome eyebrow      | "Welcome back, <name>"                |
      | AiToolsPortal        | tile grid                             |
      | Personal usage card  | $spent / reqs / top-model             |
      | Your projects card   | last-touched project list (max 5)    |
      | Recent project actv. | cross-project trace summaries (10)   |
      | Spending over time   | 14d daily-bucket chart                |
      | Recent activity      | last 10 wrapper calls                 |
    And each "Your projects" row renders { name, last activity, traces this week }
    And clicking a row routes to "/[projectSlug]/messages"

  @bdd @ui @persona-content @persona-2
  Scenario: Mixed-persona "Recent project activity" pulls from the user's projects only
    Given a user is a member of projects "alex-prod" and "alex-stg"
    And the user is NOT a member of project "isolated-team-prod"
    When the user lands on "/me" as persona "mixed"
    Then "Recent project activity" lists rows ONLY from "alex-prod" and "alex-stg"
    And NO row references "isolated-team-prod"

  @bdd @ui @persona-content @persona-2 @fallback
  Scenario: Mixed persona with stale project memberships falls back gracefully
    Given a user resolves to persona "mixed"
    And ALL the user's projects have zero application traces
    When the user lands on "/me"
    Then "Your projects" renders the project list with "no recent activity"
    And "Recent project activity" renders an EmptyState
      "No project activity in the last 14 days"
    And the AiToolsPortal + personal-usage block still render normally

  # ---------------------------------------------------------------------------
  # Persona 3 — project_only — REGRESSION INVARIANT — DO NOT TOUCH
  # ---------------------------------------------------------------------------

  @bdd @ui @persona-content @persona-3 @regression-invariant
  Scenario: LLMOps majority sees the existing project home content unchanged
    Given a user resolves to persona "project_only"
    When the user navigates to "/"
    Then they are redirected to "/<firstProjectSlug>/messages"
    And the body renders the existing trace list (no change)
    And NO "AiToolsPortal" is rendered on this surface
    And NO "Your projects" / "Recent project activity" cards appear
    And NO governance / spend-by-team cards appear

  # ---------------------------------------------------------------------------
  # Persona 4 — governance_admin — /settings/governance bird's-eye
  # ---------------------------------------------------------------------------

  @bdd @ui @persona-content @persona-4
  Scenario: Governance-admin home renders the populated bird's-eye dashboard
    Given a user resolves to persona "governance_admin"
    And the org has at least one IngestionSource with recent activity
    When the user lands on "/settings/governance"
    Then the body renders, in order:
      | section                | required                              |
      | Setup checklist        | hidden when all setup is complete     |
      | Summary cards          | Spend / Active users / Anomalies      |
      | Spend by team          | top 5 teams by spend (30d window)     |
      | Spend by user          | top 10 users by spend                 |
      | Recent anomalies       | last 10 anomaly alerts (any severity) |
      | Ingestion sources      | per-source health dots + last-seen    |
    And clicking a team row routes to a per-team drilldown
    And clicking an anomaly routes to the anomaly detail page

  @bdd @ui @persona-content @persona-4 @empty-state
  Scenario: Governance-admin home renders the setup checklist when not configured
    Given a user resolves to persona "governance_admin"
    And the org has zero IngestionSources
    When the user lands on "/settings/governance"
    Then the body renders the SETUP CHECKLIST as the primary surface
    And the checklist enumerates: routing policy, ingestion source,
      anomaly rule (with a per-step "Set up" CTA)
    And the populated dashboard sections are NOT shown
      (or are stubbed with a "Connect a source to see this" placeholder)

  # ---------------------------------------------------------------------------
  # Customization — User pin (in this PR)
  # ---------------------------------------------------------------------------

  @bdd @ui @persona-content @customization @user-pin
  Scenario: User pin overrides auto-detected persona destination
    Given a user resolves to persona "mixed" (default destination /me)
    And the user has set `User.lastHomePath = "/<projectSlug>/messages"` via /me/settings
    When the user navigates to "/"
    Then `governance.resolveHome` returns destination "/<projectSlug>/messages"
    And NOT "/me"
    And the resolution carries `isOverride: true`

  @bdd @ui @persona-content @customization @user-pin
  Scenario: User can clear their pin and revert to auto-detection
    Given a user has `User.lastHomePath` set to "/<projectSlug>/messages"
    When the user opens /me/settings
    And selects "Default landing page" → "Auto"
    Then `User.lastHomePath` is cleared (NULL)
    And the next visit to "/" resolves via auto-detection

  @bdd @ui @persona-content @customization @user-pin
  Scenario Outline: User pin picker offers only valid destinations for the user's persona
    Given a user resolves to persona "<persona>"
    When the user opens /me/settings → "Default landing page"
    Then the dropdown options include "<options>"
    And the dropdown does NOT include "<excluded>"

    Examples:
      | persona            | options                                              | excluded                      |
      | personal_only      | Auto / Personal home                                 | Project home / Governance     |
      | mixed              | Auto / Personal home / Project home                  | Governance                    |
      | project_only       | Auto / Project home                                  | Personal home / Governance    |
      | governance_admin   | Auto / Personal home / Project home / Governance     | (none)                        |

  # ---------------------------------------------------------------------------
  # Customization — Org pin (follow-up PR; contract locked here)
  # ---------------------------------------------------------------------------

  @bdd @ui @persona-content @customization @org-pin @follow-up
  Scenario: Org admin sets a default landing path that all members inherit
    Given a user is an organization admin
    And `Organization.defaultLandingPath` is unset (NULL)
    When the admin opens /settings/general → "Default member landing"
    And selects "Personal home" (`/me`)
    Then `Organization.defaultLandingPath` is set to "/me"
    And subsequent `/` visits by org members resolve to "/me"
    And NOT to their auto-detected persona destination
    And member-level user pins (if set) STILL take precedence over the org pin

  @bdd @ui @persona-content @customization @priority @follow-up
  Scenario: Resolver priority — user pin > org pin > auto-detection
    Given a user has `User.lastHomePath = "/me"`
    And `Organization.defaultLandingPath = "/<projectSlug>/messages"`
    And the user's auto-detected persona is "project_only" (default /[project]/messages)
    When the user navigates to "/"
    Then `governance.resolveHome` returns "/me"
    And `isOverride` reflects the user pin (not the org pin)
    And the org pin is honored ONLY when the user has not set their own pin
