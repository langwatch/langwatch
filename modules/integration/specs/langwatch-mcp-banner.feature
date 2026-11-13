# The LangWatch MCP callout on the Integrations page
#
# Implementation:
#   modules/integration/browser/src/ui/sections/langwatch-mcp-banner.tsx
#   modules/integration/browser/src/behavior/github-host-mount.tsx (asks Langy through LangyAskToken)
#
# Related specs:
#   specs/langy/langy-mcp-setup.feature, what Langy does with the question

Feature: The Integrations page points people to the LangWatch MCP
  As someone who opened Integrations looking for the LangWatch MCP
  I want to be told where it is set up and offered help
  So that I can use LangWatch from Claude, Cursor, ChatGPT and other AI clients

  Background:
    Given I am signed in to LangWatch
    And I open Settings, Integrations

  @integration
  Scenario: The banner points to the MCP docs
    Then a banner at the top says "Looking to add the LangWatch MCP?"
    And it says "Use LangWatch from Claude, Cursor, ChatGPT and more."
    And its "See how in the docs" link opens https://langwatch.ai/docs/integration/mcp in a new tab

  @integration
  Scenario: Ask Langy opens Langy with the MCP question
    Given Langy is installed
    When I click "Ask Langy" on the banner
    Then Langy opens and is asked "Help me connect the LangWatch MCP"

  @integration
  Scenario: Without Langy the banner offers only the docs
    Given Langy is not installed in this deployment
    Then the banner shows the docs link
    And it offers no "Ask Langy" button

  @integration
  Scenario: Only someone who may ask Langy is offered it
    Given Langy is installed
    But Langy is not rolled out to this install, or I lack langy:create
    Then the banner offers no "Ask Langy" button

  @integration
  Scenario: The ask reaches Langy, and a Langy that cannot open is reported
    Given Langy is installed, rolled out, and I hold langy:create
    When the banner asks Langy a question
    Then Langy's lent operations load and are asked that question
    And when they fail to load, I am told "Langy could not open"
