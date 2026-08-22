Feature: Mobile chrome
  As a user opening LangWatch on a phone
  I want a top bar with only the scope and a menu button
  So that the page keeps the screen and navigation stays one tap away

  On viewports narrower than the tablet breakpoint the navigation-v2
  shells replace the sidebar and the desktop top bar with a single
  compact bar: the logo, the product selector, the product's own scope
  control, and a menu button on the right. The menu button opens a
  full-screen overlay that carries the organization and project
  selectors, the product's pages, and the account controls, so nothing
  the desktop chrome offers becomes unreachable.

  @integration
  Scenario: The mobile top bar holds the scope and the menu button only
    Given I am on an LLM Ops page on a phone-width viewport
    Then the top bar shows the logo, the product selector and the project selector
    And a menu button sits on the right
    And the sidebar is not rendered

  @integration
  Scenario: LLM Ops keeps the organization out of the mobile bar
    Given I belong to two organizations
    And I am on an LLM Ops page on a phone-width viewport
    Then the top bar shows the project selector and no organization control
    And the navigation overlay offers the organization selector

  @integration
  Scenario: An organization product shows the organization in the mobile bar
    Given I am on a Gateway page on a phone-width viewport
    Then the top bar shows the organization control
    And no project selector renders

  @integration
  Scenario: The menu button opens the navigation overlay
    Given I am on an LLM Ops page on a phone-width viewport
    When I tap the menu button
    Then an overlay covers the screen with the product's pages
    And the overlay carries the account controls

  @integration
  Scenario: Navigating from the overlay closes it
    Given the navigation overlay is open
    When I open a page from it
    Then the overlay closes and the page shows

  @integration
  Scenario: The close button dismisses the overlay without navigating
    Given the navigation overlay is open
    When I tap the close button
    Then the overlay closes
    And I stay on the same page

  @integration
  Scenario: Escape closes the overlay and returns focus to the menu button
    Given the navigation overlay is open
    When I press Escape
    Then the overlay closes
    And the menu button holds focus

  @integration
  Scenario: Tablet and desktop widths keep the sidebar chrome
    Given I am on an LLM Ops page on a desktop-width viewport
    Then the sidebar renders and no menu button shows
