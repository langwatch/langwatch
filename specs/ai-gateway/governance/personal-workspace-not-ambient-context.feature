Feature: A personal workspace is never the ambient context for organization work
  A personal workspace is one person's private space inside an organization:
  one team, one project, one owner. The app also keeps an ambient context —
  the organization, team, and project that every page without a project in
  its address bar writes against. Model provider credentials are the sharp
  edge of that: the settings page files them against the ambient project, so
  a personal workspace winning there hands an organization's keys to one
  member's private space, where nobody else can see or rotate them.

  A personal team always holds exactly one project, so it satisfies any
  "first team that has a project" test and can win the ambient context on
  ordering alone.

  The line between "I am in my personal workspace" and "the app put me
  there" is the address bar. A personal project or team named in the URL
  resolves exactly as before. The remembered selection does not, because
  nothing on an organization-scoped page says which project it is about to
  write to.

  Pairs with:
    - specs/ai-gateway/governance/workspace-switcher.feature (picking a context)
    - specs/ai-gateway/governance/personal-workspace-features.feature
    - specs/model-providers/first-project-required.feature

  Background:
    Given jane belongs to organization "ACME"
    And jane has a personal workspace in "ACME" holding one personal project
    And "ACME" has a shared team holding the project "acme-app"

  # ============================================================================
  # The ambient context prefers shared teams
  # ============================================================================

  Rule: an organization-scoped page resolves to a shared team, never to a personal one

    @integration
    Scenario: The personal workspace sorts first but does not win
      Given jane's personal team is listed before the shared team
      And jane has not opened any project yet
      When jane opens an organization-scoped settings page
      Then the ambient team is the shared team
      And the ambient project is "acme-app"

    @integration
    Scenario: Organization-scoped credentials are filed against the organization's project
      Given jane is on the model providers settings page
      When jane adds a model provider
      Then the provider is created against "acme-app"
      And nothing is written into jane's personal workspace

    @integration
    Scenario: A shared team without a project still outranks a personal one
      Given the shared team holds no project yet
      When jane opens an organization-scoped settings page
      Then the ambient team is the shared team
      And there is no ambient project
      And the page says a project has to be created first
      # Better a page that names what is missing than one that silently
      # writes somewhere private.

  # ============================================================================
  # The address bar still decides
  # ============================================================================

  Rule: naming a personal workspace in the URL resolves it, exactly as before

    @integration
    Scenario: Opening the personal project by its own address
      When jane follows the personal sidebar into her personal project's traces
      Then the ambient project is her personal project
      And the ambient team is her personal team
      # The personal chrome keys off the ambient team being her own, so
      # resolving anything else here would flip the sidebar mid-navigation.

    @integration
    Scenario: Leaving the personal project releases it
      Given jane has just been in her personal project
      When jane opens an organization-scoped settings page
      Then the ambient project is "acme-app"
      # The remembered selection is stickiness, not intent. It survives the
      # last visit and would otherwise follow her onto every page that
      # carries no project of its own.

    @integration
    Scenario: The remembered selection heals after one organization-scoped page
      Given jane has just been in her personal project
      When jane opens an organization-scoped settings page
      Then the remembered project becomes "acme-app"

  # ============================================================================
  # A personal workspace is still a workspace
  # ============================================================================

  Rule: a user whose only workspace is personal keeps a working context

    @integration
    Scenario: The personal workspace is the only one there is
      Given bob belongs to an organization whose only team is his personal one
      When bob opens an organization-scoped settings page
      Then the ambient team is his personal team
      And the ambient project is his personal project
      # Nothing to prefer over it, and a user with no context at all loses
      # navigation, permissions, and half the chrome.

    @integration
    Scenario: A remembered personal team is not held against the only organization
      Given bob has just been in his personal project
      When bob opens an organization-scoped settings page
      Then the ambient project is still his personal project
