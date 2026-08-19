Feature: Navigation modes behind one flag
  As a teammate trying the new navigation
  I want my device to remember which navigation I picked
  So that I can run the new shells daily while customers keep the current one

  One product flag, release_ui_navigation_v2_enabled (default off), unlocks
  a per-device navigation mode with three values: legacy (the app exactly
  as today), product-switcher (a top-bar dropdown switches products) and
  icon-rail (a left rail switches products). The mode is a device
  preference in localStorage, never synced to the account. With the flag
  off the current chrome renders unchanged, whatever the stored mode.

  With the flag on, a device that never picked a mode runs the product
  switcher. Picking "Old navigation" is an opt-out and keeps the current
  chrome.

  The mode resolves without flicker. A device that picked legacy never
  waits for a flag check. A device that picked a new mode never flashes
  the old chrome while the check runs. A device that picked nothing never
  waits either: it paints the answer the flag last gave it, which is the
  current chrome until the flag has answered on at least once.

  Background:
    Given I am signed in

  @integration
  Scenario: A device with no stored preference runs the product switcher
    Given my device has no stored navigation mode
    And the navigation flag is on for me
    When the app shell resolves the navigation mode
    Then the mode is "product-switcher"

  @integration
  Scenario: A device with no stored preference and the flag off keeps the old navigation
    Given my device has no stored navigation mode
    And the navigation flag check has not answered yet
    When the app shell resolves the navigation mode
    Then the mode is "legacy" immediately
    And no loading screen is shown

  @integration
  Scenario: A device that saw the flag on paints the new navigation first
    Given my device has no stored navigation mode
    And the flag was on the last time this device asked
    And the navigation flag check has not answered yet
    When the app shell resolves the navigation mode
    Then the mode is "product-switcher" immediately

  @integration
  Scenario: A device set to legacy never waits for the flag
    Given my device stored the navigation mode "legacy"
    When the app shell resolves the navigation mode
    Then the mode is "legacy" immediately
    And no feature flag check runs

  @integration
  Scenario: A device set to a new mode waits for the flag instead of flashing the old chrome
    Given my device stored the navigation mode "product-switcher"
    And the navigation flag check has not answered yet
    When the app shell resolves the navigation mode
    Then the resolution is still loading
    And the old chrome is not shown in the meantime

  @integration
  Scenario: The flag on honours the stored mode
    Given my device stored the navigation mode "icon-rail"
    And the navigation flag is on for me
    When the app shell resolves the navigation mode
    Then the mode is "icon-rail"

  @integration
  Scenario: The flag off falls back to legacy and keeps the preference
    Given my device stored the navigation mode "product-switcher"
    And the navigation flag is off for me
    When the app shell resolves the navigation mode
    Then the mode is "legacy"
    And the stored preference is still "product-switcher"

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
  Scenario: The avatar menu offers the three navigation modes
    Given the navigation flag is on for me
    When I open the avatar menu
    Then a "Navigation" entry shows the current mode
    And it offers "Old navigation", "Product switcher" and "Icon rail"

  @integration
  Scenario: Flag off keeps the current chrome unchanged
    Given the navigation flag is off for me
    When I open any project page
    Then the sidebar, the workspace switcher and the page body render as today
    And the avatar menu shows its current items
    And the avatar menu has no "Navigation" entry

  @integration
  Scenario: Legacy mode keeps the personal sidebar on a personal page
    Given my device is on the old navigation
    When I open my personal page
    Then the personal sidebar renders instead of the project menu

  @integration
  Scenario: Internal ops pages render in the new settings shell
    Given the navigation flag is on for me
    And my device is in a new navigation mode
    When I open an internal ops page
    Then the new settings shell renders around it
    And the ops page is not treated as a product page

  @integration
  Scenario: A page outside the new shells keeps the old navigation
    Given the navigation flag is on for me
    And my device is in a new navigation mode
    When I open a page the new shells do not cover
    Then the old chrome renders instead of a new shell

  @integration
  Scenario: Legacy mode runs no navigation-v2 queries
    Given my device is on the old navigation
    When I open the home page
    Then no product reachability check runs
    And the home page picks my landing page the way it does today
