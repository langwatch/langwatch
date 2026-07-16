Feature: Langy panel layout modes

  The Langy panel has two user-picked layouts: a floating card that overlays
  the page, and a full-height sidebar dock that pushes page content left.
  The floating card overlays content, so it can afford to be wide; the
  docked sidebar takes its width FROM the page for as long as it is open,
  so it runs narrower and denser — on a laptop screen the page must keep
  enough room to work in.

  Background:
    Given I am signed in with access to a project that has Langy

  Scenario: The docked sidebar is narrower than the floating card
    Given the Langy panel is open in floating mode
    When I switch the panel to sidebar mode
    Then the panel docks to the right edge at a narrower width than the floating card
    And page content shifts left by exactly the docked width minus the corner overlap

  Scenario: The docked sidebar is denser than the floating card
    Given the Langy panel is open in sidebar mode
    Then the conversation column uses tighter padding and message spacing than floating mode

  Scenario: Closing the dock returns the page to full width
    Given the Langy panel is open in sidebar mode
    When I close the panel
    Then page content reclaims the full viewport width
