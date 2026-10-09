Feature: Navigation modes
  As a user of LangWatch
  I want to pick between the product switcher and the icon rail
  So that my device renders the navigation shape that suits me

  The navigation has two modes: product-switcher (a top-bar dropdown
  switches products) and icon-rail (a left rail switches products). The
  mode is a device preference in localStorage, never synced to the
  account. The product switcher is what a device runs when its reader
  never picked.

  The mode resolves on the first frame: it is a local read, so no
  loading screen and no flash can happen.

  Background:
    Given I am signed in

  @integration
  Scenario: A device with no stored preference runs the product switcher
    Given my device has no stored navigation mode
    When the app shell resolves the navigation mode
    Then the mode is "product-switcher"

  @integration
  Scenario: The stored mode decides the shell
    Given my device stored the navigation mode "icon-rail"
    When the app shell resolves the navigation mode
    Then the mode is "icon-rail"

  @integration
  Scenario: Garbage in storage counts as no stored choice
    Given my device stored "banana" as the navigation mode
    When the app shell reads the stored navigation mode
    Then the device counts as having picked no mode

  @integration
  Scenario: Picking a mode persists on the device
    When I set the navigation mode to "icon-rail"
    Then the device remembers "icon-rail" for the next visit

  @integration
  Scenario: The avatar menu offers the two navigation modes
    When I open the avatar menu
    Then a "Navigation" entry shows the current mode
    And it offers "Product switcher" and "Icon rail"

  @integration
  Scenario: Internal ops pages render in the new settings shell
    Given my device is in a new navigation mode
    When I open an internal ops page
    Then the new settings shell renders around it
    And the ops page is not treated as a product page

  @integration
  Scenario: A signed-out share page renders without the app chrome
    Given I am not signed in
    When I open a shared trace page
    Then the page renders in a plain frame with a sign-in entry
    And no navigation mode is consulted
