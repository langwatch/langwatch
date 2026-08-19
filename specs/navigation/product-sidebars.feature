Feature: Product sidebars in the new navigation modes
  As a user on a new navigation mode
  I want the sidebar to hold only the pages of the product I am in
  So that each product reads as its own coherent surface

  Both new modes share one sidebar frame: Quick Search first, then the
  product's own pages, then a pinned bottom block with usage, Settings,
  Support and the theme control. The product bodies reuse the same
  components the current chrome renders, so the two presentations
  cannot drift: LLM Ops and Me keep their current sections minus the
  Govern group (the product switcher replaces it), and Gateway and
  Governance promote their section pages from the shared registry.

  @integration
  Scenario: Quick Search sits first and opens the command bar
    Given a product sidebar in a new navigation mode
    When I use the Quick Search entry
    Then the command bar opens

  @integration
  Scenario: The LLM Ops sidebar keeps the project sections without the Govern group
    Given I am on an LLM Ops page in a new navigation mode
    Then the sidebar shows the Observe, Test and Build sections
    And the Govern group is not there

  @integration
  Scenario: The Me sidebar keeps the personal pages without the Govern group
    Given I am on a Me page in a new navigation mode
    Then the sidebar shows the personal pages
    And the Govern group is not there

  @integration
  Scenario: The Gateway sidebar promotes the gateway pages
    Given I am on a Gateway page in a new navigation mode
    Then the sidebar lists the gateway pages from the shared registry

  @integration
  Scenario: The Governance sidebar promotes the governance pages
    Given I am on a Governance page in a new navigation mode
    Then the sidebar lists the governance pages from the shared registry

  @integration
  Scenario: The sidebar bottom block keeps usage, settings, support and theme
    Given a product sidebar in a new navigation mode
    Then the bottom block holds the usage indicator, Settings, Support and the theme control

  @integration
  Scenario: Chat moves inside the Support menu in the new modes
    Given a product sidebar in a new navigation mode
    When I open the Support menu
    Then I see "Chat (with a human)" as the first entry
    And there is no standalone chat entry in the sidebar

  @integration
  Scenario: The current chrome keeps the standalone chat entry
    Given the current chrome on the cloud version
    Then the sidebar shows the standalone "Chat" entry
    And the Support menu has no chat entry
