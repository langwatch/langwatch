@agent
Feature: Agent draws trace's Setup via Agent menu by token

  Trace owns the "Setup via Agent" menu and lends it with SetupWithAgentButtonToken
  (ARCHITECTURE.md §10.1). Agent's empty states read that token, never a capability
  declaration, which §15 deletes for a peer lend.

  @integration
  Scenario: The connected agents empty state draws trace's lent menu
    Given trace lends its Setup via Agent menu with SetupWithAgentButtonToken
    When the connected agents empty state renders the menu for its surface
    Then the empty state draws trace's menu with that surface

  @integration
  Scenario: No module lends the Setup via Agent menu
    Given no module lends SetupWithAgentButtonToken
    When the connected agents empty state renders the menu
    Then the empty state draws nothing in its place
