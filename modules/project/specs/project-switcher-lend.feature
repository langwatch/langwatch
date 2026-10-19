Feature: Project lends its switcher by token

  Project owns the choice of project, so it lends its switcher with
  ProjectSwitcherToken (ARCHITECTURE.md §10, the peer lend of §10.1). A page
  outside the navigation shell reads that token through its host mount, never
  through a capability declaration, which §15 deletes for a peer lend.

  @integration
  Scenario: A page outside the navigation shell draws project's lent switcher
    Given project lends its switcher with ProjectSwitcherToken
    When the secrets, audit log or authorize page renders its header
    Then the header draws project's switcher

  @integration
  Scenario: No module lends a switcher
    Given no module lends ProjectSwitcherToken
    When the page renders its header
    Then the header draws nothing
