# The mocked home-content scenarios (Welcome back, Your projects, setup checklist, pin picker rows) were deleted:
# they exist on neither branch. The resolver itself is bound in persona-home-resolver.feature.

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
  # ---------------------------------------------------------------------------
  # Persona 1 — personal_only — /me with AiToolsPortal + personal usage
  # ---------------------------------------------------------------------------

  # ---------------------------------------------------------------------------
  # Persona 2 — mixed — /me with personal + projects + cross-project activity
  # ---------------------------------------------------------------------------

  # ---------------------------------------------------------------------------
  # Persona 3 — project_only — REGRESSION INVARIANT — DO NOT TOUCH
  # ---------------------------------------------------------------------------

  # ---------------------------------------------------------------------------
  # Persona 4 — governance_admin — /governance bird's-eye
  # (canonical Overview path; the legacy /settings/governance address
  #  redirects there per specs/navigation/gateway-url-move.feature)
  # ---------------------------------------------------------------------------

  # ---------------------------------------------------------------------------
  # Customization — User pin (in this PR)
  # ---------------------------------------------------------------------------

  @bdd @ui @persona-content @customization @user-pin @unit
  Scenario: User pin overrides auto-detected persona destination
    Given a user resolves to persona "mixed" (default destination /me)
    And the user has set `User.lastHomePath = "/<projectSlug>/messages"` via /me/settings
    When the user navigates to "/"
    Then `governance.resolveHome` returns destination "/<projectSlug>/messages"
    And NOT "/me"
    And the resolution carries `isOverride: true`

  @unit
  Scenario: The picker's "Project home" option never names a personal workspace
    Given the resolver excludes personal workspaces from the project it would route to (ADR-038 v6)
    When the picker builds its "Project home" option
    Then it reads the resolver's own firstProjectSlug
    And it never offers a personal workspace slug a separate unfiltered query might return

  # ---------------------------------------------------------------------------
  # Customization — Org pin (follow-up PR; contract locked here)
  # ---------------------------------------------------------------------------
