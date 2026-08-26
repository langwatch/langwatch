Feature: Workspace switcher
  As a user who works across teams and projects
  I want one context switcher in the header
  So that I can jump between My Workspace, my teams and my projects

  The switcher renders in the shell's top bar and drives the "current
  context" chip. It also holds the per-team create-project affordance,
  auto-detects the current context from the URL, and drops the personal
  "My Workspace" row when no organization the user belongs to enables
  governance.

  Background:
    Given I am signed in

  # -------------------------------------------------------------------------
  # Personal "My Workspace" gating
  # -------------------------------------------------------------------------

  @integration
  Scenario: The personal entry is hidden when no organization enables governance
    Given I belong to organizations that all have governance off
    When I open the workspace switcher
    Then no "My Workspace" row is shown

  @integration
  Scenario: The personal entry shows when any organization enables governance
    Given I belong to at least one organization with governance on
    When I open the workspace switcher
    Then a "My Workspace" row is shown

  @integration
  Scenario: My Workspace nests under each governance-enabled organization
    Given I belong to more than one organization with governance on
    When I open the workspace switcher
    Then each governance organization renders its own "My Workspace" row under its name

  @integration
  Scenario: An organization without governance shows no My Workspace row
    Given one organization I belong to has governance off
    When I open the workspace switcher
    Then no "My Workspace" row shows under that organization

  @integration
  Scenario: With a single governance organization, My Workspace links to /me
    Given exactly one organization I belong to enables governance
    When I click "My Workspace"
    Then the browser opens "/me"

  @integration
  Scenario: A single governance organization still shows its name with My Workspace nested under it
    Given exactly one organization I belong to enables governance
    When I open the workspace switcher
    Then that organization's name renders in the personal group
    And "My Workspace" nests under it

  @integration
  Scenario: With multiple governance organizations, each My Workspace carries its org
    Given more than one organization I belong to enables governance
    When I open the workspace switcher
    Then each "My Workspace" row carries the name of its organization

  # -------------------------------------------------------------------------
  # Per-team create-project affordance
  # -------------------------------------------------------------------------

  @integration
  Scenario: The dropdown shows a per-team "Create project" button (admin-only)
    Given I am an admin of a team
    When I open the workspace switcher
    Then the team row shows a "Create project" button

  @integration
  Scenario: The "Create project" button is suppressed for non-admin members
    Given I am a member (not admin) of a team
    When I open the workspace switcher
    Then the team row shows no "Create project" button

  @integration
  Scenario: The "Create project" tooltip never auto-opens on switcher mount
    When I open the workspace switcher
    Then no "Create project" tooltip is visible before I hover the button

  @integration
  Scenario: The "+" button is not auto-focused on dropdown open
    When I open the workspace switcher
    Then the "Create project" button does not carry focus

  @integration
  Scenario: The "Create project" tooltip still appears on actual pointer hover
    Given the workspace switcher is open
    When I hover the "Create project" button
    Then the tooltip appears

  @integration
  Scenario: A coding-usage signup can always create their first shared project from the workspace menu
    Given I am an admin of a team with no projects
    When I open the workspace switcher
    Then the team row is present
    And its "Create project" button is enabled

  @integration
  Scenario: An empty team stays hidden from members who cannot create a project on it
    Given I am a member (not admin) of a team with no projects
    When I open the workspace switcher
    Then that team row is not shown

  # -------------------------------------------------------------------------
  # Org-scoped variant
  # -------------------------------------------------------------------------

  @integration
  Scenario: On an org-scoped route the switcher shows the organization as the current chip
    Given I open an organization-scoped route
    Then the switcher chip shows the organization name

  @integration
  Scenario: A multi-org user switches organization in place from the org-scoped switcher
    Given I belong to more than one organization
    And I open an organization-scoped route
    When I pick another organization from the switcher
    Then the app writes the chosen organization id to selectedOrganizationId
    And the browser opens "/settings"

  # -------------------------------------------------------------------------
  # Project switching (buildProjectSwitchHref)
  # -------------------------------------------------------------------------

  @unit
  Scenario: Picking a different project preserves the current sub-route
    Given I am on a project sub-route
    When I pick another project from the switcher
    Then the browser opens the same sub-route on the target project

  @unit
  Scenario: Picking a project from a route with extra dynamic segments
    Given I am on a project route that carries extra dynamic segments
    When I pick another project from the switcher
    Then the browser opens the target project's home
    And the extra segments are dropped

  @unit
  Scenario: Picking a project from a non-project route falls back to project root
    Given I am on a route with no project segment
    When I pick another project from the switcher
    Then the browser opens the target project's root
