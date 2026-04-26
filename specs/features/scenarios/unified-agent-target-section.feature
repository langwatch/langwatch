Feature: Unified agent target section in scenario menus
  As a user running scenarios
  I want a single "Agent" section listing all agent types together
  So that I don't have to scan separate sections for HTTP vs Code agents

  Background:
    Given a project with HTTP agents and Code agents configured
    And published prompts exist

  @integration @unimplemented
  Scenario: SaveAndRunMenu shows agents in a single section
    When I open the Save and Run dropdown
    Then I see a single "Run against Agent" section
    And both HTTP agents (with globe icon) and Code agents (with code icon) appear in that section
    And I see a separate "Run against Prompt" section below

  @integration @unimplemented
  Scenario: TargetSelector shows agents in a single section
    When I open the target selector popover
    Then I see a single "Agents" section
    And both HTTP agents and Code agents appear in that section with distinguishing icons
    And I see a separate "Prompts" section below

  @integration @unimplemented
  Scenario: Search filters across all agent types
    Given I have an HTTP agent named "My HTTP Bot"
    And I have a Code agent named "My Code Bot"
    When I open the Save and Run dropdown
    And I search for "My"
    Then both "My HTTP Bot" and "My Code Bot" appear in the agents section
