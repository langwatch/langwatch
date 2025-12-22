@unit
Feature: Simplified Setup Page
  As a user
  I want a focused setup page
  So that I can configure my API connection without distraction

  Background:
    Given I am on the setup page
    And I have access to project "test-project"

  # API Key section
  Scenario: Displays API key section
    When I view the setup page
    Then I should see an "API key" section
    And I should see my project's API key (masked or visible)

  Scenario: Can copy API key
    When I click the copy button for the API key
    Then the API key should be copied to clipboard

  # Endpoint section (non-cloud)
  Scenario: Displays endpoint section for self-hosted
    Given I am on a self-hosted instance (not app.langwatch.ai)
    When I view the setup page
    Then I should see an "Endpoint" section

  Scenario: Hides endpoint section for cloud
    Given I am on app.langwatch.ai
    When I view the setup page
    Then I should not see an "Endpoint" section

  # SDK setup guides
  Scenario: Displays SDK setup guides
    When I view the setup page
    Then I should see SDK setup options
    And I should see at least Python and TypeScript options

  Scenario: SDK guides link to documentation
    When I click on a SDK guide
    Then I should be taken to the relevant docs page

  # Removed sections (moved to home)
  Scenario: Does NOT display integration checks
    When I view the setup page
    Then I should not see an "Integration checks" section

  Scenario: Does NOT display resources section
    When I view the setup page
    Then I should not see a "Resources" section with demo/docs/community links

  Scenario: Does NOT display agent simulation section
    When I view the setup page
    Then I should not see an "Agent Simulation Testing" section

  # Integration status alerts
  Scenario: Shows Integration configured alert when firstMessage exists
    Given the project has received its first message
    When I view the setup page
    Then I should see a success indicator
    And I should see text indicating integration is configured

  Scenario: Shows Waiting for messages when no firstMessage
    Given the project has not received its first message
    When I view the setup page
    Then I should see a waiting/pending indicator
    And I should see text about waiting for messages

  # Tracking
  Scenario: API key copy is tracked
    When I copy the API key
    Then a tracking event should be sent for "api_key_copy"
