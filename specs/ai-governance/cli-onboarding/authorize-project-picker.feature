Feature: Authorize page project picker - honest selection and a path for empty orgs
  As a user approving `langwatch login --project` in the browser
  I want the project picker to say what is actually selected and to always give me a way forward
  So that I am never stuck on "Multiple" with zero projects or dead-ended without shared projects

  # Background
  #
  # The /cli/auth page (project_api_key mode) offers the projects a key can be
  # minted for. Historically it hid personal workspace projects entirely, so a
  # user with no shared projects saw an empty picker and a dead-end card, and
  # the generic scope picker presented "Multiple" as the active state when
  # nothing was selected. Personal is now an explicit, clearly-labelled entry:
  # picking it is a deliberate act, never implied by an org or team selection.

  Background:
    Given a signed-in user on /cli/auth with a pending project_api_key device code

  @bdd @cli-onboarding @authorize-picker @unit
  Scenario: zero selected reads "None selected", never "Multiple"
    Given a scope picker with quick-pick chips and zero scopes selected
    When the picker renders
    Then the active state reads "None selected"
    And no element presents "Multiple" as the current selection

  @bdd @cli-onboarding @authorize-picker @integration
  Scenario: a user with no shared projects gets their personal project preselected
    Given the user's organization has no shared projects
    And the user has a personal workspace project
    When the authorize page renders the project picker
    Then the personal project is listed as an explicit "Personal" entry
    And it is preselected
    And the approve button is enabled

  @bdd @cli-onboarding @authorize-picker @integration
  Scenario: the no-shared-projects state offers a create-project action
    Given the user's organization has no shared projects
    When the authorize page renders
    Then a "Create project" action is visible
    And activating it opens the create-project drawer without requiring an ambient project
    And a project created there becomes selected in the picker

  @bdd @cli-onboarding @authorize-picker @integration
  Scenario: a user with shared projects sees personal as an explicit entry, not an implication
    Given the user's organization has shared projects
    When the authorize page renders the project picker
    Then the shared projects are listed under their teams
    And the personal project is listed under a separate "Personal" group
    And selecting a team's project never implies personal access

  @bdd @cli-onboarding @authorize-picker @integration
  Scenario: approving with the personal project selected returns the personal project key
    Given the user explicitly selected their personal project
    When the user approves
    Then the server returns the personal project's API key to the CLI poll
    And the key lands in the terminal's .env exactly like a shared project key

  @bdd @cli-onboarding @authorize-picker @integration
  Scenario: the server still refuses a personal project that is not the caller's own
    Given an approve request naming another user's personal project id
    When the server handles the approval
    Then it responds 400 personal_project_not_allowed
    And no key is returned
