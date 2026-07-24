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
      | governance_admin   | /governance               |
    And resolution is via `governance.resolveHome` tRPC

  # ---------------------------------------------------------------------------
  # Pre-persona: fresh-signup org-less user — must NOT enter the persona
  # resolver yet. They land on /onboarding/welcome to bootstrap their first
  # org + Personal Team + Personal Project + RoleBindings, then the resolver
  # picks their canonical persona destination. (Ariana QA G73 caught the
  # regression where org-less users dead-ended at /me with skeleton cards
  # + Access-Restricted on /governance; fixed by `137965526`.)
  # ---------------------------------------------------------------------------

  # Routing branch in pages/index.tsx (the org-less → /onboarding/welcome
  # path) shipped at 137965526. No e2e covers the fresh-signup → onboarding
  # → resolver chain end-to-end. Pin @unimplemented until a Playwright
  # signup-flow test exercises the full bootstrap sequence.
  @bdd @ui @persona-content @bootstrap @regression @unimplemented
  Scenario: Fresh-signup user with no org bootstraps via /onboarding/welcome before the persona resolver runs
    Given a user has just completed /auth/signup
    And the user has zero Organization memberships (no org, no team, no project)
    When they hit "/" or any post-auth landing
    Then they are routed to "/onboarding/welcome" (NOT /me, NOT /governance)
    And the welcome page calls `api.onboarding.initializeOrganization`
    And that call creates: an Organization, a Personal Team membership,
        2 RoleBindings (Owner on the org + Member on the personal team),
        and a first project under the new org
    And only after that step completes does `governance.resolveHome` run
    And the resolver then routes the user per their canonical persona
        (org owner with no IngestionSources → /governance with the
        empty-state setup checklist)

    # Regression-invariant — `pages/index.tsx:39-50` previously routed all
    # org-less users to /me with a "persona-1 personal-only is a first-class
    # persona" comment, but persona-1 by spec definition has Personal Team +
    # Personal Project + Personal VK — which means non-empty
    # `organizations.length`. The org-less branch was actually catching
    # post-signup admins between signup and `initializeOrganization`,
    # dead-ending them at /me skeletons + Access-Restricted on /governance.
    # The bootstrap step is the missing precondition for the persona
    # resolver, not a special case OF the persona resolver.

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
  Scenario: Mixed-persona home additionally renders the user's projects card
    Given a user resolves to persona "mixed"
    And the user is a member of at least one project (ProjectMember row)
    When the user lands on "/me"
    Then the body renders, in order:
      | section              | required                              |
      | Welcome eyebrow      | "Welcome back, <name>"                |
      | AiToolsPortal        | tile grid                             |
      | Your projects card   | last-touched project list (max 5)    |
      | Personal usage card  | $spent / reqs / top-model             |
      | Spending over time   | 14d daily-bucket chart                |
      | Recent activity      | last 10 wrapper calls                 |
    And each "Your projects" row renders { project name, team subtitle, chevron }
    And clicking a row routes to "/[projectSlug]/messages"
    And the per-row last-activity timestamp is NOT shown until a project-level
      activity-time field exists (today projects sort by updatedAt as a coarse
      proxy; rendering it would mislead since updatedAt fires on any project
      edit, not just trace activity)

  @bdd @ui @persona-content @persona-2
  Scenario: Mixed-persona "Your projects" card lists only the user's own projects
    Given a user is a member of projects "alex-prod" and "alex-stg"
    And the user is NOT a member of project "isolated-team-prod"
    When the user lands on "/me" as persona "mixed"
    Then "Your projects" lists rows ONLY for "alex-prod" and "alex-stg"
    And NO row references "isolated-team-prod"

  @bdd @ui @persona-content @persona-2 @hidden-projects
  Scenario: Mixed persona "Your projects" excludes hidden internal_governance projects
    Given a user is a member of an org with both application projects
      and at least one hidden internal_governance project
      (auto-created lazily on first IngestionSource mint)
    When the user lands on "/me"
    Then "Your projects" lists ONLY application-kind projects
    And NO row references the hidden governance project
      (regression-invariant — same hidden-project filter as every other
      user-facing project picker)

  @bdd @ui @persona-content @persona-2 @follow-up
  Scenario: Mixed persona cross-project Recent activity panel — DEFERRED
    Given the user has multiple projects with recent traces
    When the user lands on "/me"
    Then a "Recent project activity" panel SHOULD eventually render
      cross-project trace summaries (max 10) sorted by occurredAt DESC
    But this scenario is deferred to a follow-up PR — the cross-project
      user-scoped trace query is a new fold shape; the v1 ship covers
      "Your projects" with last-touched only

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
  # Persona 4 — governance_admin — /governance bird's-eye
  # (canonical Overview path; /settings/governance is registered as a
  #  back-compat alias per langwatch/src/routes.tsx — both routes serve
  #  the same page until the alias is removed in a future cleanup)
  # ---------------------------------------------------------------------------

  @bdd @ui @persona-content @persona-4
  Scenario: Governance-admin home renders the populated bird's-eye dashboard
    Given a user resolves to persona "governance_admin"
    And the org has at least one IngestionSource with recent activity
    When the user lands on "/governance"
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
    When the user lands on "/governance"
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
