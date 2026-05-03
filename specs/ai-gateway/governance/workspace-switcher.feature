Feature: AI Gateway Governance — Workspace Switcher (top-left context dropdown)
  As a developer who wears multiple hats — myself, member of teams, contributor
  to projects — I want a single, always-visible context dropdown in the header
  that lets me flip between my personal workspace, any team I belong to, and any
  project I work on
  So that I can see "what context am I currently working in" at a glance, and
  "show me usage / settings / VKs scoped to that context" without hunting
  through tabs

  Per gateway.md "screen 6 — workspace switcher problem":
    The dropdown lives top-left in the dashboard layout header. Three groups:
      - 👤 My Workspace (always present, always first)
      - 👥 Teams (alphabetical, only teams the user is a member of)
      - 📦 Projects (alphabetical, only projects the user has access to)
    The currently-selected entry has a checkmark + bold label.
    Picking a team navigates to the team's overview/dashboard page.
    Picking "My Workspace" navigates to /me.

  This component must persist the user's last-picked context across navigations
  via cookie or query param, so refreshing a page doesn't reset the context.

  Background:
    Given user "jane@acme.com" is signed in to organization "acme"
    And jane has a personal team "Jane's Workspace" + personal project
    And jane is a member of teams ["Sales Engineering", "Growth Experiments"]
    And jane is a contributor on projects ["30-Agent Sales System", "growth-funnels-eval"]

  # ---------------------------------------------------------------------------
  # Visual layout
  # ---------------------------------------------------------------------------

  @bdd @ui @workspace-switcher @layout
  Scenario: Switcher is rendered in the top-left of the DashboardLayout header
    When I navigate to any LangWatch page using DashboardLayout (e.g. "/me", a project page, settings)
    Then the workspace switcher is the first element in the header bar
    And it shows the current context label, e.g. "My Workspace ▼" or "Sales Engineering ▼"
    And the icon is `User` for personal, `Users` for team, `Folder` for project

  @bdd @ui @workspace-switcher @dropdown
  Scenario: Opening the dropdown shows all three groups with proper grouping & order
    When I click the workspace switcher
    Then a dropdown opens with three sections in this order:
      | section          | label                  | items                                     |
      | personal         | "My Workspace"         | exactly one entry — the user's personal   |
      | teams            | "Teams"                | all teams the user is a member of (alpha) |
      | projects         | "Projects"             | all projects the user has access to (alpha) |
    And each section is visually separated by a thin divider
    And under each entry is a one-line subtitle (e.g. "Personal usage, personal budget", "Team I'm part of", "Project I work on")

  @bdd @ui @workspace-switcher @selection
  Scenario: Currently-selected entry shows a checkmark
    Given the user is currently on a Sales Engineering team page
    When the user opens the switcher
    Then the "Sales Engineering" row shows a `Check` icon and bolded label
    And no other row shows a check

  # ---------------------------------------------------------------------------
  # Navigation
  # ---------------------------------------------------------------------------

  @bdd @ui @workspace-switcher @navigation
  Scenario: Picking "My Workspace" navigates to /me
    Given the switcher is currently set to a team
    When I pick "My Workspace"
    Then the browser navigates to "/me"
    And the switcher chip in the header re-renders with "My Workspace" + the User icon

  @bdd @ui @workspace-switcher @navigation
  Scenario: Picking a team navigates to that team's overview/dashboard page
    Given there exists a route "/team/<team-slug>/dashboard" (or whatever the team default landing is)
    When I pick the "Sales Engineering" team
    Then the browser navigates to that route with team-slug "sales-engineering"
    And the switcher chip re-renders with "Sales Engineering" + Users icon

  @bdd @ui @workspace-switcher @navigation
  Scenario: Picking a project navigates to that project's main dashboard
    When I pick the "30-Agent Sales System" project
    Then the browser navigates to that project's main dashboard route (existing /[project] entry point)
    And the switcher chip re-renders with the project name + Folder icon

  # ---------------------------------------------------------------------------
  # Persistence
  # ---------------------------------------------------------------------------

  @bdd @ui @workspace-switcher @persist
  Scenario: Refreshing a page preserves the current context
    Given I picked "Sales Engineering" 5 minutes ago
    And the URL reflects the team's overview page
    When I refresh the page
    Then the switcher still shows "Sales Engineering"

  @bdd @ui @workspace-switcher @persist
  Scenario: Opening the app from a fresh tab restores my last context
    Given I last left the app on the "30-Agent Sales System" project page
    When I open a new tab and navigate to "https://app.langwatch.example.com"
    Then the app redirects to the last picked context (the project)
    And the switcher reflects that
    And if the user has no last-picked-context, the default is "My Workspace"

  # ---------------------------------------------------------------------------
  # Empty / single-context states
  # ---------------------------------------------------------------------------

  @bdd @ui @workspace-switcher @empty
  Scenario: A user in no teams sees only the "My Workspace" entry plus a hint
    Given user "newhire@acme.com" is in zero teams and zero projects
    When she opens the switcher
    Then she sees only the "My Workspace" entry
    And below it a hint reads "Ask your admin to add you to a team to see more contexts here."

  @bdd @ui @workspace-switcher @single-team
  Scenario: A solo user (no teams/projects) — switcher remains visible but does not auto-collapse
    Given the user only has access to "My Workspace"
    When the page renders
    Then the switcher is still in the header (consistent layout)
    But it is non-interactive (no hover/cursor) until more contexts exist

  # ---------------------------------------------------------------------------
  # Accessibility
  # ---------------------------------------------------------------------------

  @bdd @ui @workspace-switcher @a11y
  Scenario: Switcher is keyboard-operable
    When I tab to the switcher button
    Then it has a visible focus ring
    And pressing Enter / Space opens the dropdown
    And arrow-down moves focus through entries
    And Enter on a focused entry navigates as if clicked
    And Escape closes the dropdown without navigating

  @bdd @ui @workspace-switcher @a11y
  Scenario: Switcher entries have proper ARIA roles
    When the dropdown is open
    Then the trigger button has `aria-haspopup="menu"` and `aria-expanded="true"` while open
    And each entry has role="menuitem"
    And the section headings have role="presentation" (separators)

  # ---------------------------------------------------------------------------
  # Auto-detected current context from URL
  # ---------------------------------------------------------------------------
  #
  # Iter 4 polish: the switcher derives its `current` selection from the
  # router pathname rather than requiring every consumer to thread the prop
  # through. This makes the component drop-in across DashboardLayout,
  # MyLayout, and any future Settings sub-layout without per-call wiring.
  # The hook lives in `components/me/useWorkspaceCurrent.ts` and consumers
  # may still override by passing `current` explicitly.

  @bdd @ui @workspace-switcher @auto-current
  Scenario: On /me the switcher auto-detects "personal" without a prop
    Given the user is on "/me" or "/me/settings"
    And the consumer renders <WorkspaceSwitcher /> without a `current` prop
    Then the trigger label is "My Workspace"
    And the User icon is shown
    And inside the dropdown the personal row carries the active checkmark

  @bdd @ui @workspace-switcher @auto-current
  Scenario: On a project page the switcher auto-detects the active project
    Given the URL is "/<project-slug>" or any "/[project]/..." sub-route
    And the project resolves through the existing useOrganizationTeamProject hook
    And the consumer renders <WorkspaceSwitcher /> without a `current` prop
    Then the trigger label is the project's display name
    And the Folder icon is shown
    And inside the dropdown the matching project row carries the active checkmark

  @bdd @ui @workspace-switcher @auto-current
  Scenario: On a team route the switcher auto-detects the team
    Given the URL is "/settings/teams/<team-slug>"
    And the slug matches a team the user belongs to
    And the consumer renders <WorkspaceSwitcher /> without a `current` prop
    Then the trigger label is the team's display name
    And the Users icon is shown
    And inside the dropdown the matching team row carries the active checkmark

  @bdd @ui @workspace-switcher @auto-current
  Scenario: On a route that doesn't map to any context the switcher reads "Choose workspace"
    Given the URL is "/settings/billing" (no team or project context)
    And the consumer renders <WorkspaceSwitcher /> without a `current` prop
    Then the trigger label is "Choose workspace"
    And no row in the dropdown has an active checkmark

  @bdd @ui @workspace-switcher @auto-current
  Scenario: Explicitly passed `current` prop overrides auto-detection
    Given the URL is "/me" (auto-detection would pick personal)
    And the consumer renders <WorkspaceSwitcher current={{ kind: "team", teamId: "team_a" }} />
    Then the trigger label is the team's display name
    And the team row carries the active checkmark
    And the personal row does NOT carry the checkmark

  # ---------------------------------------------------------------------------
  # DashboardLayout consolidation (Stage 2c — replace legacy ProjectSelector)
  # ---------------------------------------------------------------------------
  #
  # rchaves's "no second systems" audit (iter 4) identified ProjectSelector
  # (src/components/DashboardLayout.tsx) and WorkspaceSwitcher
  # (src/components/WorkspaceSwitcher.tsx) as duplicate implementations of
  # the same context-switcher UX pattern. WorkspaceSwitcher is the
  # superset (Personal + Teams + Projects vs Projects-only). Stage 2c
  # promotes WorkspaceSwitcher to be the single context picker rendered
  # in DashboardLayout's header, preserving the existing
  # ProjectSelector UX (project avatar in trigger, route preservation on
  # click, per-team "+ New project" button) and deleting the legacy
  # component.

  @bdd @ui @workspace-switcher @consolidation @stage-2c
  Scenario: DashboardLayout renders WorkspaceSwitcher in the header (not ProjectSelector)
    Given the user is signed in and on a project page
    When the DashboardLayout chrome renders
    Then exactly one workspace switcher is in the header bar
    And it is rendered by `<WorkspaceSwitcher>` (not the legacy
        `ProjectSelector` component)
    And `ProjectSelector` is not exported from anywhere in the codebase
        (the component is deleted in this stage)

  @bdd @ui @workspace-switcher @route-preservation @stage-2c
  Scenario: Picking a different project preserves the current sub-route
    Given the user is on "/<project-old>/messages?view=table"
    When the user opens the switcher and picks "<project-new>"
    Then the browser navigates to "/<project-new>/messages?view=table"
    And the sub-route + query string are preserved
    And the switcher chip re-renders with the new project name

  @bdd @ui @workspace-switcher @route-preservation @stage-2c
  Scenario: Picking a project from a route with extra dynamic segments
    Given the user is on "/<project-old>/messages/trace_xyz/spans"
    And the route pattern is "/[project]/messages/[trace]/[openTab]"
    When the user picks "<project-new>"
    Then the browser navigates to "/<project-new>/messages" (parent route)
    And the user is NOT taken to a 404 like "/<project-new>/messages/trace_xyz/spans"

  @bdd @ui @workspace-switcher @route-preservation @stage-2c
  Scenario: Picking a project from a non-project route falls back to project root
    Given the user is on "/me/settings"
    When the user picks "<project-new>"
    Then the browser navigates to
        "/<project-new>?return_to=%2Fme%2Fsettings"
    And the project root page MAY redirect back to /me/settings after
        loading (preserves intent without breaking the project's
        own redirect logic)

  @bdd @ui @workspace-switcher @add-project @stage-2c
  Scenario: The dropdown shows a per-team "+ New project" button (admin-only)
    Given the user is an organization admin OR a team admin on team T
    When the user opens the switcher
    Then within team T's "Projects" group there is a "+ New project" entry
    And clicking it opens the existing CreateProject drawer
        (`useDrawer().openDrawer("createProject", ...)`)
    And the user's org-membership / team-membership filters apply (a
        viewer-only member on team T sees no "+ New project" entry there)

  @bdd @ui @workspace-switcher @add-project @stage-2c
  Scenario: The "+ New project" button is suppressed for non-admin members
    Given the user is a regular member (not admin) on team T
    When the user opens the switcher
    Then no "+ New project" entry is rendered in team T's group
        (non-admins cannot create projects from this UI)

  @bdd @ui @workspace-switcher @persistence @stage-2c
  Scenario: Picking a project from a non-project route persists selectedProjectSlug
    Given the user is on "/settings/teams/<team-slug>"
    When the user picks "<project-new>"
    Then localStorage.selectedProjectSlug is set to "<project-new>"
    And subsequent visits to ambiguous routes can default to that project
