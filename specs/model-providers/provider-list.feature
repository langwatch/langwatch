Feature: Model Provider List Management
  As a user managing model providers
  I want to see a list of enabled providers with clear indicators
  So that I can understand which providers are available and configured

  Background:
    Given I am logged in
    And I have access to a project
    And I have "project:view" permission

  @visual
  Scenario: Model providers page layout
    When I am on the Model Providers settings page
    Then I see a page title "Model Providers"
    And I see an "Add Model Provider" button
    And I see a table for listing providers

  @visual
  Scenario: Provider row structure
    Given providers are enabled in the project
    When I am on the Model Providers settings page
    Then each provider row shows:
      | element       | type   |
      | Provider icon | image  |
      | Provider name | text   |
      | Menu button   | button |

  @visual
  Scenario: Empty state appearance
    Given no model providers are enabled
    When I am on the Model Providers settings page
    Then I see an empty state with:
      | element     | content                              |
      | Icon        | plus icon                            |
      | Title       | No model providers                   |
      | Description | Add a model provider to get started  |

  @visual
  Scenario: Loading state appearance
    Given the providers are loading
    When I am on the Model Providers settings page
    Then I see a spinner
    And the provider list is not visible

  @integration @unimplemented
  Scenario: Display enabled providers with icons and names
    Given I navigate to the Model Providers settings page
    When the page loads
    Then I see a table listing all enabled model providers
    And each provider row shows the provider icon
    And each provider row shows the provider name

  @integration @unimplemented
  Scenario: Show "Default Model" badge when default model belongs to provider
    Given I have a project with default model "openai/gpt-4o"
    And I have "openai" provider enabled
    When I navigate to the Model Providers settings page
    Then I see the "openai" provider in the list
    And the "openai" provider row shows a "Default Model" badge
    And the badge has blue color palette

  @integration @unimplemented
  Scenario: Hide "Default Model" badge when default model does not belong to provider
    Given I have a project with default model "anthropic/claude-sonnet-4"
    And I have "openai" provider enabled
    When I navigate to the Model Providers settings page
    Then I see the "openai" provider in the list
    And the "openai" provider row does not show a "Default Model" badge

  @integration
  Scenario: "Add Model Provider" menu lists every provider regardless of existing rows
    Given I have "openai" provider with one row configured
    And I have "anthropic" provider not configured
    When I click "Add Model Provider"
    Then I see a menu with all provider types
    And the menu still includes "openai" so a second row can be created
    # See scope-and-multi-instance.feature — multiple rows per provider type
    # are a first-class concept now.

  @integration @unimplemented
  Scenario: Disable "Add Model Provider" button without manage permission
    Given I do not have "project:manage" permission
    When I navigate to the Model Providers settings page
    Then the "Add Model Provider" button is disabled
    And a tooltip explains I need model provider manage permissions
