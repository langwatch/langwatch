Feature: Shared section navigation layout
  As a LangWatch user
  I want complex product areas to use the same local navigation shell
  So that their hierarchy, spacing, and dividers remain visually consistent

  Scenario Outline: Render a consistent local navigation shell
    Given I open the <section> workspace
    Then its section title appears above the local navigation in the left column
    And its current sub-page title appears in the content column beside the local navigation
    And the two title rows share a 48px height and a text baseline
    And the first navigation entry starts 8px below the title row
    And a landing page uses its sub-page name instead of repeating the section title
    And the local navigation divider uses the shared muted border color and starts below the title row
    And no horizontal rule appears above or below the shared title row
    And the workspace is constrained to the shared readable maximum width
    And the content column uses only the space remaining beside the local navigation

    Examples:
      | section     |
      | Automations |
      | Analytics |
      | Agent Testing |
      | Annotations |
      | Authentication |
      | Event Sourcing |

  # A fixed-width rail that never shrinks does not degrade on a phone, it
  # disappears: the content column is left with a handful of pixels and the
  # page it was framing cannot be read at all.
  @integration @unimplemented
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

  # The product sidebar already lists the Gateway and Governance pages, so
  # their local rail would be the same list twice.
  @integration
  Scenario: The rail stands down when the product sidebar carries the pages
    Given I open a Gateway or Governance page
    Then the local navigation rail is not there
    And the content takes the full width of the card

  @integration
  Scenario: A rail of page-local destinations stays
    Given I open the Automations workspace
    Then its local navigation rail renders

  @integration
  Scenario: A text rail preserves operational counts
    Given Event sourcing has seven dead letters
    When I open its overview
    Then the rail shows the section title and the content heading says "Overview"
    And the Dead letters link still shows the total beside its text

  @integration @regression @unimplemented
  Scenario: The local navigation stays visible while page content scrolls
    Given a section page contains more content than fits in the viewport
    When I scroll the page content on a desktop or phone
    Then the local navigation remains in place
    And the page content scrolls independently
