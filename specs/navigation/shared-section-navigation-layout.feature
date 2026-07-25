Feature: Shared section navigation layout
  As a LangWatch user
  I want complex product areas to use the same local navigation shell
  So that their hierarchy, spacing, and dividers remain visually consistent

  Scenario Outline: Render a consistent local navigation shell
    Given I open the <section> workspace
    Then its section title appears above the local navigation in the left column
    And its page title appears in the content column beside the local navigation
    And the local navigation divider uses the shared muted border color
    And the workspace is constrained to the shared readable maximum width
    And the content column uses only the space remaining beside the local navigation

    Examples:
      | section       |
      | Automations   |
      | AI Gateway    |
      | AI Governance |

  Scenario: Keep product-level and local navigation labels distinct
    Given I open the primary project navigation
    Then the expandable product section is named "Build"
    And its Automations destination is named "Automations"
    When I open the Automations destination
    Then the first local navigation item is named "Overview"
    And the page heading is named "Overview"
