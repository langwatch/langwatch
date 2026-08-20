Feature: Product switcher navigation
  As a user on the product-switcher navigation mode
  I want the top bar to carry the product, organization and scope
  So that the sidebar holds only the pages of the product I am in

  The product-switcher shell renders when the device mode is
  "product-switcher" and the navigation flag is on. The top bar reads,
  left to right: the logo, the product dropdown, the organization, and
  the product-native scope. The dropdown advertises each product with
  its pitch line so a first-time visitor learns what each one does.
  Settings and internal ops pages keep the current chrome until their
  own shells land.

  On small screens the sidebar keeps the responsive collapse the
  current chrome has; the hover-expanded rail behaves the same way.

  @integration
  Scenario: The product switcher lists the reachable products with their pitch lines
    Given I am on the product-switcher mode
    And I can reach LLM Ops and the Gateway
    When I open the product switcher
    Then I see "LLM Ops" with "Observe, evaluate and test your agents"
    And I see "Gateway" with "Route, meter and bill LLM usage"
    And the product I am in carries the active mark

  @integration
  Scenario: A product I cannot reach is not offered
    Given I am on the product-switcher mode
    And Governance is not reachable for me
    When I open the product switcher
    Then Governance is not in the list

  @integration
  Scenario: Switching product opens that product's home
    Given I am on an LLM Ops page in the product-switcher mode
    When I pick "Gateway" in the product switcher
    Then I am sent to the Gateway home

  @integration
  Scenario: The product selector reads as a raised pill
    Given I am on the product-switcher mode
    When the top bar renders
    Then the product selector has its own surface, a border and a radius

  @integration
  Scenario: The organization and the scope start at the content column
    Given I am on the product-switcher mode
    When the top bar renders
    Then the logo and the product selector take the width of the sidebar column
    And the organization and the scope start where the content column starts
    And they stay there when the product name is longer or shorter

  @integration
  Scenario: A single organization shows as plain text
    Given I belong to one organization
    When the product-switcher top bar renders
    Then the organization name is plain text with no menu

  @integration
  Scenario: A multi-organization user switches organization in place
    Given I belong to two organizations
    When I pick the other organization in the top bar
    Then the device stores that organization as selected
    And the stored project selection is cleared
    And I am sent to the same product in that organization when it is reachable there

  @integration
  Scenario: The LLM Ops scope shows the project switch chip
    Given I am on an LLM Ops page in the product-switcher mode
    Then the top bar shows the current project as a chip
    And the chip opens a menu with the organization's projects

  @integration
  Scenario: The Me scope shows my name with a Personal badge
    Given I am on a Me page in the product-switcher mode
    Then the top bar shows my name with a "Personal" badge

  @integration
  Scenario: LLM Ops opens from the personal workspace
    Given I am on a Me page in the product-switcher mode
    When I open the product switcher
    Then LLM Ops is offered rather than greyed out
    And picking it opens the project I last worked in
    # The Me pages run in the personal workspace, and LLM Ops opens a
    # project of the organization. Reading the personal project as "no
    # project" left the way back into LLM Ops closed.

  @integration
  Scenario: LLM Ops opens a project I can reach when I have opened none yet
    Given I am on a Me page in the product-switcher mode
    And I have opened no project on this device
    When I pick "LLM Ops" in the product switcher
    Then I am sent to a project of a team I am allowed to open

  @integration
  Scenario: LLM Ops stays closed when the organization holds no project for me
    Given I am on a Me page in the product-switcher mode
    And no team I am allowed to open holds a project
    When I open the product switcher
    Then LLM Ops is greyed out

  @integration
  Scenario: Gateway and Governance carry no scope control
    Given I am on a Gateway page in the product-switcher mode
    Then the top bar shows no project chip and no personal badge

  @integration
  Scenario: The sidebar ignores the page's auto-hide request in the new modes
    Given a page that collapses the sidebar in the current chrome
    When it renders in the product-switcher mode
    Then the sidebar stays expanded

  @unit
  Scenario: A project whose slug reads like a product keeps the project shell
    Given a project whose slug starts with the name of a top-level product
    When I open one of its pages
    Then the page renders as a project page in the LLM Ops product
    And it does not render as the personal or the settings surface
