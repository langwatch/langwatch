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

  # A fixed-width rail that never shrinks does not degrade on a phone, it
  # disappears: the content column is left with a handful of pixels and the
  # page it was framing cannot be read at all.
  @integration
  Scenario: The local navigation stops taking a column on a narrow viewport
    Given I open a section workspace on a phone-width screen
    Then the local navigation sits above the content instead of beside it
    And it scrolls sideways rather than pushing the content off the screen
    And the content column gets the full width of the page

  Scenario: Keep product-level and local navigation labels distinct
    Given I open the primary project navigation
    Then the expandable product section is named "Build"
    And its Automations destination is named "Automations"
    When I open the Automations destination
    Then the first local navigation item is named "Overview"
    And the page heading is named "Overview"

  # Everything above describes the legacy chrome, which every device on the
  # legacy navigation mode keeps unchanged. In the new navigation modes the
  # product sidebar already lists the Gateway and Governance pages, so their
  # local rail would be the same list twice.
  @integration
  Scenario: The rail stands down when the product sidebar carries the pages
    Given I open a Gateway or Governance page in a new navigation mode
    Then the local navigation rail is not there
    And the content takes the full width of the card

  @integration
  Scenario: A rail of page-local destinations stays in the new modes
    Given I open the Automations workspace in a new navigation mode
    Then its local navigation rail renders as it does today
