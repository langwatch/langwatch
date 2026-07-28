Feature: Connect your agent from the /me usage home
  As a /me user whose account already has traces
  I want a "Connect your agent" button on the My Usage home
  So that Langy or my own coding agent can explore where my usage actually went

  # Two different jobs, two different controls. The empty-state control on the
  # traces integrate pane is SETUP and keeps the shared "Setup via Agent"
  # label on every surface, personal projects included. "Connect your agent"
  # is the /me home's EXPLORATION control: it appears only once usage exists
  # and points an agent at the reader's own traces and spend.
  #
  # The appearance gate is Project.firstMessage on the personal project, the
  # same first-traces signal the authorize page's post-login watch polls
  # (specs/ai-governance/cli-onboarding/post-login-first-trace-redirect.feature).
  #
  # The menu mirrors the SetupWithAgent anatomy: Langy first (permission
  # gated), a copy-a-prompt route for the reader's own coding agent, then the
  # docs guide. The copied prompt leans on the /me credentials work
  # (specs/ai-governance/cli-onboarding/me-credentials.feature): the langwatch
  # CLI resolves the device login by itself, so a fresh coding-agent session
  # can paste the prompt and immediately read the user's own usage with no
  # API key and no env vars.

  Background:
    Given a signed-in user on the /me usage home

  @bdd @personal-portal @connect-your-agent @unit
  Scenario: the /me home hides Connect your agent before the first trace
    Given the personal project has never received a trace
    When the My Usage home renders
    Then no "Connect your agent" button is shown

  @bdd @personal-portal @connect-your-agent @unit
  Scenario: the /me home shows Connect your agent once the personal project has traces
    Given the personal project has received its first trace
    When the My Usage home renders
    Then the My Usage header carries a "Connect your agent" menu button

  @bdd @personal-portal @connect-your-agent @unit
  Scenario: the menu offers Langy exploration, a coding-agent prompt, and the guide
    Given the personal project has traces
    When the reader opens the Connect your agent menu
    Then it offers "Explore via Langy" with the hint "Ask Langy where your tokens went"
    And it offers "Explore via your coding agent" with a copy-a-prompt hint
    And it offers "Read the guide" linking the explore-your-usage docs page

  @bdd @personal-portal @connect-your-agent @unit
  Scenario: Explore via Langy hands Langy a usage-exploration prompt
    Given the reader can ask Langy
    When the reader picks "Explore via Langy"
    Then Langy opens seeded with a prompt about where the tokens went

  @bdd @personal-portal @connect-your-agent @unit
  Scenario: copying the exploration prompt arms a coding agent to self-inspect
    When the reader picks "Explore via your coding agent"
    Then the clipboard receives the exploration prompt
    And the prompt says the langwatch CLI works with the device login, no API key needed
    And the prompt names `langwatch trace search` and the analytics spend read
    And a confirmation toast appears

  @bdd @personal-portal @connect-your-agent @unit
  Scenario: readers who cannot ask Langy keep the prompt and guide routes
    Given asking Langy is not available to the reader
    When the reader opens the Connect your agent menu
    Then "Explore via Langy" is absent
    And the coding-agent prompt and the guide remain

  @bdd @personal-portal @connect-your-agent @unit
  Scenario: the docs guide carries the same coding-agent prompt the menu copies
    Given the explore-your-usage docs page
    Then its copy-paste prompt is byte-identical to the menu's clipboard prompt

  @bdd @personal-portal @button-copy @unit
  Scenario: the traces empty state keeps Setup via Agent on every project
    Given the traces integrate pane renders for a personal or shared project
    Then the empty-state agent menu button reads "Setup via Agent"
