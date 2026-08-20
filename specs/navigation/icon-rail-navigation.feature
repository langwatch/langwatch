Feature: Icon rail navigation
  As a user on the icon-rail navigation mode
  I want a left rail with one tile per product
  So that every product stays one click away and always visible

  The icon-rail shell renders when the device mode is "icon-rail" and
  the navigation flag is on. A darker full-height rail on the far left
  carries the logo, one tile per reachable product (the icon with a tiny
  label under it, a white active tile with a side indicator), and a
  Settings tile pinned to the bottom. The top bar keeps the organization
  and the product-native scope but drops the product dropdown, since the
  rail already carries the product. The sidebar is the same product
  sidebar the product-switcher mode renders.

  @integration
  Scenario: The rail is its own surface next to the sidebar
    Given I am on the icon-rail mode
    When the rail renders
    Then the rail sits on a gray one step off the page gray
    And an edge closes the rail against the sidebar

  @integration
  Scenario: The page keeps its right edge inside the window
    Given I am on the icon-rail mode
    When a page wider than the room it has renders
    Then the page ends at the right edge of the window
    And the room it has is the window less the rail and the sidebar
    # The rail and the sidebar both take room from the page. Counting the
    # rail as room the page gains instead of room it loses left every page
    # in this mode two rails too wide, and the right of a full page (the ops
    # dashboard first) was cut off the window.

  @integration
  Scenario: Only the active tile carries a surface
    Given I am on the icon-rail mode
    Then the tile of the product I am in has a raised white surface
    And the other tiles have no surface

  @integration
  Scenario: The rail lists the reachable products as tiles
    Given I am on the icon-rail mode
    And I can reach every product
    Then the rail shows a tile for Me, LLM Ops, Gateway and Governance
    And the tile of the product I am in carries the active mark

  @integration
  Scenario: A product I cannot reach has no tile
    Given I am on the icon-rail mode
    And Governance is not reachable for me
    Then the rail has no Governance tile

  @integration
  Scenario: Picking a rail tile opens that product's home
    Given I am on an LLM Ops page in the icon-rail mode
    When I pick the Gateway tile
    Then I am sent to the Gateway home

  @integration
  Scenario: The Settings tile sits at the bottom of the rail
    Given I am on the icon-rail mode
    When I pick the Settings tile
    Then I am sent to the settings pages

  @integration
  Scenario: The top bar drops the product dropdown in the icon-rail mode
    Given I am on the icon-rail mode
    Then the top bar has no product dropdown
    And the organization and the product scope stay in the top bar
