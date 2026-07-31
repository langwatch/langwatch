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
    - specs/model-providers/providers-without-a-project.feature

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
  # The ambient context is a team the caller is actually on
  # ============================================================================

  Rule: the ambient team is one the caller holds a membership on

    The teams the app resolves against are the organization's, not the
    caller's: a member is handed every shared team in the organization, and
    only their own membership row inside each. A preference expressed purely
    as "the first team shaped like X" therefore elects a team the member is
    not on the moment an organization has more than one, and the chrome then
    refuses the page outright with "You are not part of any team in this
    organization". The settings surfaces are where it bites, because they
    write against the ambient project, so the refusal replaces every
    /settings page at once and the alternative to refusing would be writing
    into another team's project.

    Background:
      Given "ACME" has a second shared team "ACME Platform", listed first
      And mia belongs to the shared team holding "acme-app", and not to
        "ACME Platform"

    @integration
    Scenario: A member resolves the team they are on, not the first one listed
      Given mia has not opened any project yet
      When mia opens an organization-scoped settings page
      Then the ambient team is the shared team she belongs to
      And the page renders instead of refusing her

    @integration
    Scenario: The ambient project belongs to the team the member is on
      When mia opens an organization-scoped settings page
      Then the ambient project is "acme-app"

    @integration
    Scenario: A remembered team the member is not on does not win
      Given mia's remembered selection names "ACME Platform"
      When mia opens an organization-scoped settings page
      Then the ambient team is still the shared team she belongs to

    @integration
    Scenario: The remembered selection heals to the team the member is on
      Given mia's remembered selection names "ACME Platform"
      When mia opens an organization-scoped settings page
      Then the remembered team and project become the ones she belongs to

    @integration
    Scenario: A genuine non-member is still refused
      Given mia belongs to no team in "ACME"
      When mia opens an organization-scoped settings page
      Then a context still resolves
      And she is told she is not part of any team
      # The refusal needs a resolved context to render inside. Leaving the
      # context undefined replaces it with a loading screen that never ends.

    @integration
    Scenario: A project named in the URL still resolves its own team
      When mia opens "ACME Platform"'s project by its own address
      Then the ambient team is "ACME Platform"
      And she is told she is not part of any team
      # Typing someone else's project into the address bar is a question
      # with an honest answer. Only the sticky, unasked-for selection is
      # held to the membership test.

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

  # ============================================================================
  # /me is the one exception: it means the personal workspace on purpose
  # ============================================================================

  Rule: the personal-workspace page itself resolves to the personal team, never the shared one

    A page with no project in its address bar is normally organization-scoped
    work, which is exactly why the ambient context prefers a shared team. `/me`
    and its sub-routes are the one page family where that assumption is
    backwards: they ARE the personal workspace, so resolving them to the
    organization's shared team instead hands every personal-scope feature
    (Langy chief among them) a project that is either the wrong one or does
    not exist, even though nothing in the address bar or the remembered
    selection asked for that.

    @integration
    Scenario: Visiting the personal-workspace page resolves the personal team
      Given jane's personal team is listed before the shared team
      And jane has not opened any project yet
      When jane opens her personal-workspace page
      Then the ambient team is her personal team
      And the ambient project is her personal project

    @integration
    Scenario: A shared team without a project does not leak into the personal-workspace page
      Given the shared team holds no project yet
      When jane opens her personal-workspace page
      Then the ambient team is still her personal team
      And the ambient project is still her personal project
      # The organization-scoped equivalent of this fixture correctly leaves
      # the page without a project; /me must not inherit that outcome just
      # because the same project-less shared team exists in the organization.

    @integration
    Scenario: Every personal-workspace sub-route gets the same treatment
      When jane opens a sub-page of her personal-workspace page
      Then the ambient team is still her personal team

    @integration
    Scenario: A team remembered from an earlier organization-scoped visit does not follow jane onto the personal-workspace page
      Given jane's last remembered team selection is the shared team, from an
        earlier organization-scoped page
      When jane opens her personal-workspace page
      Then the ambient team is her personal team, not the remembered shared one
      # A stale PERSONAL selection fading off an organization-scoped page is
      # already handled (see "Leaving the personal project releases it"
      # above). The mirror case is what this locks in: a stale SHARED
      # selection must not follow her onto the personal-workspace page
      # either, because that page can never mean anything but her own
      # workspace.

    @integration
    Scenario: A member with no personal workspace of their own falls back to the ambient team
      Given an external member belongs only to the shared team
      When that member opens the personal-workspace page
      Then the ambient team is the shared team
      # The /me preference only ever adds a resolution, never a requirement:
      # someone with no personal team gets the same ambient fallback as
      # every organization-scoped page already does.
