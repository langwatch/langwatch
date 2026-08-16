Feature: Navigation modes behind one flag
  As a teammate trying the new navigation
  I want my device to remember which navigation I picked
  So that I can run the new shells daily while customers keep the current one

  One product flag, release_ui_navigation_v2_enabled (default off), unlocks
  a per-device navigation mode with three values: legacy (the app exactly
  as today), product-switcher (a top-bar dropdown switches products) and
  icon-rail (a left rail switches products). The mode is a device
  preference in localStorage, never synced to the account. With the flag
  off, or the mode legacy, the current chrome renders unchanged.

  The mode resolves without flicker: a device on legacy must never wait
  for a flag check, and a device on a new mode must never flash the old
  chrome while the flag check runs.

  Background:
    Given I am signed in

  @integration
  Scenario: A device with no stored preference stays on the old navigation
    Given my device has no stored navigation mode
    When the app shell resolves the navigation mode
    Then the mode is "legacy" immediately
    And no feature flag check runs

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
  Scenario: Garbage in storage counts as legacy
    Given my device stored "banana" as the navigation mode
    When the app shell resolves the navigation mode
    Then the mode is "legacy" immediately

  @integration
  Scenario: Picking a mode persists on the device
    When I set the navigation mode to "icon-rail"
    Then the device remembers "icon-rail" for the next visit

  @integration
  Scenario: Flag off keeps the current chrome unchanged
    Given the navigation flag is off for me
    When I open any project page
    Then the sidebar, the workspace switcher and the page body render as today
    And the avatar menu shows its current items
    And the avatar menu has no "Navigation" entry
