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
    Given user "jane@miro.com" is signed in to organization "miro"
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
    Given user "newhire@miro.com" is in zero teams and zero projects
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
