Feature: Presence toggle placement in the chrome
  As a user navigating LangWatch with multiplayer presence enabled
  I want the "Sharing presence" control out of the main left navigation
  So that the sidebar stays focused on navigation, and the broadcast
  preference is reachable from the avatar menu only on surfaces where
  presence is meaningful

  # The toggle is meaningful exclusively on the traces lens today, so
  # surfacing it on every page bloated the main menu without earning
  # its keep. Moving it to the avatar menu keeps it close at hand for
  # operators on /traces and clears it everywhere else.

  @unit
  Scenario: Main left navigation no longer renders the presence toggle
    Given the main left navigation is rendered on any page
    Then the "Sharing presence" toggle is not present in the left sidebar
    And the sidebar bottom rail contains only Settings, Support, and the theme switch

  @unit
  Scenario: Avatar menu surfaces the presence toggle on the traces page
    Given the user is signed in
    And the user is on the /traces page for a project
    When the user opens the avatar dropdown in the top right
    Then a "Sharing presence" row is rendered inside the dropdown
    And clicking the row toggles the user's broadcast preference

  @unit
  Scenario: Avatar menu omits the presence toggle off the traces page
    Given the user is signed in
    And the user is on a non-traces page (e.g. /messages, /analytics, /settings)
    When the user opens the avatar dropdown in the top right
    Then no "Sharing presence" row is rendered inside the dropdown
