Feature: AI Gateway Governance — Persona-aware chrome (sidebar + header)
  As LangWatch is becoming both an LLMOps observability platform AND an AI
  Governance platform, four distinct user personas land on the app every day
  with very different needs. The product chrome (sidebar + header selector)
  must adapt to the user's current context so that:
    - personal-only users (Persona 1) don't drown in project chrome they don't use
    - hybrid users (Persona 2) can flip context cleanly
    - the LLMOps majority (Persona 3 — ~90% today) sees zero regression
    - governance admins (Persona 4) see Govern/Gateway sections only when
      they apply

  Per gateway.md Screen 6: a personal home is `⚡ LangWatch  [My Workspace ▼]
  …  jane@miro.com ⚙` — ONE workspace chip, no project sidebar, no Govern
  unless gated.

  This spec is the LAYOUT-LAYER contract. The persona resolver
  (`PersonaResolverService`) and home-routing redirect (`/` → resolved
  destination) are already shipped (`e40ee0045`); this feature locks down
  the chrome that the user actually SEES once they land.

  Spec: complements specs/ai-gateway/governance/persona-home-resolver.feature
        complements specs/ai-gateway/governance/workspace-switcher.feature
        Storyboard ground truth: ~/Downloads/gateway.md Screen 6

  Background:
    Given the four canonical personas are defined as:
      | persona            | description                                          |
      | personal_only      | CLI user with personal VK; no team/project access    |
      | mixed              | personal + team membership + project access          |
      | project_only       | LLMOps majority — admin on project(s); no AI gateway |
      | governance_admin   | org admin + Enterprise + has IngestionSources        |
    And persona is resolved via `governance.resolveHome` tRPC + `useWorkspaceCurrent`

  # ---------------------------------------------------------------------------
  # Persona 3 — LLMOps majority — REGRESSION SAFETY (the 90%)
  # ---------------------------------------------------------------------------

  @bdd @ui @persona-chrome @persona-3 @regression-invariant
  Scenario: LLMOps admin without governance state sees the existing project chrome unchanged
    Given user is org admin
    And the org has application traces but no IngestionSources, no PersonalVKs, no AnomalyRules
    When the user navigates to "/[project]/messages"
    Then the header renders the legacy `ProjectSelector` chip (NOT WorkspaceSwitcher)
    And the sidebar renders the LLMOps stack: Home, Observe, Evaluate, Library
    And the sidebar does NOT render the "Govern" section
    And the sidebar does NOT render the "Gateway" section
    And no chrome change is observable vs the pre-governance shipped UX

  @bdd @ui @persona-chrome @persona-3 @home-routing
  Scenario: LLMOps admin clicking Home stays in project context
    Given user is on "/[project]/messages" as Persona 3
    When the user clicks the LangWatch logo in the header
    Then the browser navigates to "/" which redirects via `governance.resolveHome`
    And the resolver returns destination "/[project]/messages"
    And the user lands back on their project home — NOT on /me, NOT on /governance

  # ---------------------------------------------------------------------------
  # Persona 1 — personal-only — clean Screen-6 chrome
  # ---------------------------------------------------------------------------

  @bdd @ui @persona-chrome @persona-1
  Scenario: Personal-only user lands on /me with the Screen-6 chrome
    Given user has a Personal Team + Personal Project but no shared team membership
    And the user has at least one Personal VK
    When the user navigates to "/" (or signs in fresh)
    Then `governance.resolveHome` returns destination "/me"
    And on /me the header renders ONE chip — `WorkspaceSwitcher` showing "My Workspace"
    And the header does NOT render the legacy `ProjectSelector`
    And the sidebar is the personal-scope sidebar — only "My Usage" + "Settings"
    And the sidebar does NOT render Home, Observe, Evaluate, Library, Govern, or Gateway
    And the body of /me does NOT render a redundant "My Workspace ▼" chip in-page
    And the body of /me does NOT render a redundant "MY WORKSPACE" eyebrow header

  @bdd @ui @persona-chrome @persona-1
  Scenario: Personal-only user stays in personal scope from any /me sub-route
    Given user is on /me as Persona 1
    When the user navigates to "/me/settings"
    Then the chrome shape is preserved — same WorkspaceSwitcher, same personal sidebar
    And the active sidebar item is "Settings"

  # ---------------------------------------------------------------------------
  # Persona 2 — hybrid (personal + projects) — scope-aware sidebar
  # ---------------------------------------------------------------------------

  @bdd @ui @persona-chrome @persona-2 @scope-aware
  Scenario: Hybrid user on personal scope sees the personal sidebar
    Given user is a member of at least one project AND has personal VKs
    And the user is currently on "/me"
    When the chrome renders
    Then the header renders `WorkspaceSwitcher` with "My Workspace" active
    And the sidebar is the personal-scope sidebar — "My Usage" + "Settings"
    And the sidebar does NOT render LLMOps sections (Observe, Evaluate, Library)

  @bdd @ui @persona-chrome @persona-2 @scope-aware
  Scenario: Hybrid user switching to a project scope sees the LLMOps sidebar
    Given user is on /me as Persona 2
    When the user picks a project from the WorkspaceSwitcher dropdown
    Then the browser navigates to "/<project-slug>"
    And the header renders `WorkspaceSwitcher` with that project active
    And the sidebar switches to the LLMOps stack — Home, Observe, Evaluate, Library
    And the sidebar still does NOT render Govern or Gateway (no admin role / no FF / no IngestionSources)

  @bdd @ui @persona-chrome @persona-2 @home-routing
  Scenario: Hybrid user clicking Home routes to their resolved persona destination
    Given user is on "/[project]/messages" as Persona 2
    When the user clicks the LangWatch logo
    Then the browser navigates to "/" which redirects via `governance.resolveHome`
    And the resolved destination is the user's last-picked context (or default)

  # ---------------------------------------------------------------------------
  # Persona 4 — governance admin — Govern + Gateway sections gated
  # ---------------------------------------------------------------------------

  @bdd @ui @persona-chrome @persona-4 @gating
  Scenario: Governance + Gateway visibility = admin permission AND feature flag (no data gate)
    Given the visibility gate is two-clause AND, with Govern + Gateway each
        keyed on its own product feature flag (the flags can roll out
        independently — customers may want Gateway without Governance,
        Governance without Gateway, or both):
      | section  | permission predicate                  | feature-flag predicate                  |
      | Govern   | user has governance:view permission   | release_ui_ai_governance_enabled = on   |
      | Gateway  | user has virtualKeys:view permission  | release_ui_ai_gateway_menu_enabled = on |
    When the user opens any LLMOps page
    Then the sidebar shows the "Govern" section iff both Govern predicates are true
    And the sidebar shows the "Gateway" section iff both Gateway predicates are true
    And neither section is additionally gated on hasIngestionSources or other state —
        admins must see Govern to mint their first IngestionSource (bootstrap flow);
        gating on data presence creates a chicken-and-egg discoverability trap.
    And the feature flag is the operator's rollout knob; the permission is the audience predicate.

    # `governance:view` is one of 5 governance Resources in the rbac.ts catalog
    # (governance, ingestionSources, anomalyRules, complianceExport,
    # activityMonitor). ADMIN role default-grants the full set; MEMBER +
    # EXTERNAL get nothing by default; custom roles via the
    # CustomRolePermissions JSON column compose any subset (e.g. a
    # "security_analyst" custom role granting governance:view +
    # activityMonitor:view + anomalyRules:view).

  @bdd @ui @persona-chrome @persona-4
  Scenario: Governance admin lands on /governance with the org-scope chrome
    Given user is org admin on Enterprise plan
    And the org has at least one IngestionSource
    And `release_ui_ai_governance_enabled` AND `release_ui_ai_gateway_menu_enabled` are both enabled
    When the user navigates to "/" (fresh sign-in)
    Then `governance.resolveHome` returns destination "/governance"
    And the chrome on /governance renders the org-scope header (org name banner, NOT ProjectSelector)
    And the sidebar shows Home + Observe + Evaluate + Library + Govern + Gateway

  @bdd @ui @persona-chrome @persona-4 @ff-off-regression
  Scenario: Govern section vanishes when its feature flag flips off (independent of Gateway)
    Given user is Persona 4 with both sections visible
    When `release_ui_ai_governance_enabled` is flipped off org-wide
    Then on the next page render the "Govern" section is hidden
    And the "Gateway" section remains visible (its FF — `release_ui_ai_gateway_menu_enabled` — is independent)
    And no other chrome state changes (LLMOps stack remains intact)
    And operator-side runbook covers "don't flip flag off for orgs with active governance data"

  @bdd @ui @persona-chrome @persona-4 @ff-off-regression
  Scenario: Gateway section vanishes when its feature flag flips off (independent of Govern)
    Given user is Persona 4 with both sections visible
    When `release_ui_ai_gateway_menu_enabled` is flipped off org-wide
    Then on the next page render the "Gateway" section is hidden
    And the "Govern" section remains visible (its FF — `release_ui_ai_governance_enabled` — is independent)
    And the two flags allow independent product-pilot rollout shapes:
        Gateway-only customers, Governance-only customers, or both

  # ---------------------------------------------------------------------------
  # Header chip — single source of context truth
  # ---------------------------------------------------------------------------

  @bdd @ui @persona-chrome @selector
  Scenario: Header renders exactly one workspace chip, never two
    Given any persona on any page
    When the chrome renders
    Then exactly one of these is rendered in the header:
      | chip                       | when                                          |
      | WorkspaceSwitcher          | personal-scope (Persona 1, or Persona 2 on /me) |
      | ProjectSelector            | project-scope (Persona 3, Persona 2/4 on project) |
      | org-name banner (Building2)| org-scope routes (/governance, /ops)           |
    And the body of the page does NOT render a second redundant chip
    And the body of the page does NOT render a "MY WORKSPACE" eyebrow header

  @bdd @ui @persona-chrome @selector
  Scenario: Personal-scope WorkspaceSwitcher includes Personal + Teams + Projects groups
    Given user is on /me with multiple teams + projects
    When the user clicks the WorkspaceSwitcher
    Then the dropdown lists three groups in this order:
      | group         | label          |
      | personal      | "My Workspace" |
      | teams         | "Teams"        |
      | projects      | "Projects"     |
    And the active row carries a Check icon + bold label
    And subtitle text per the Workspace Switcher spec (workspace-switcher.feature)

  # ---------------------------------------------------------------------------
  # Implementation contract (informative, for the layout layer)
  # ---------------------------------------------------------------------------
  #
  # - DashboardLayout accepts `personalScope`, `orgScope` props (existing).
  # - When `personalScope`, DashboardLayout renders WorkspaceSwitcher in the
  #   header (NOT ProjectSelector) and renders a `PersonalSidebar` (NOT MainMenu).
  # - `MyLayout` shrinks to use DashboardLayout with personalScope=true and
  #   stops rendering its own redundant header chip + eyebrow.
  # - `MainMenu` (project-scope sidebar) gates Govern + Gateway sections per
  #   the persona-4 conjunctive gate above. Already wired for Govern via
  #   `setupState.governanceActive`; Gateway already gated via FF + permission.
  # - `/` page redirects via `governance.resolveHome` (already shipped).
  # - The LangWatch logo in the header links to `/` so all three personas
  #   route through the resolver when clicking Home.

  @bdd @ui @persona-chrome @no-regression
  Scenario: All 4 personas can navigate Home without 404 / wrong-context lands
    Given a user of any persona on any page
    When the user clicks the LangWatch logo
    Then the navigation target is "/" (unconditional)
    And `governance.resolveHome` resolves the correct destination per persona
    And the user lands on a page that renders cleanly (no 404, no infinite redirect)
