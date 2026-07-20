Feature: Langy panel layout modes

  The Langy panel has two user-picked layouts: a sidebar dock attached to the
  right edge that reserves room so page content is never covered (the
  default), and a floating card that overlays the page. The floating card overlays content, so it
  can afford to be wide; the docked sidebar takes its width FROM the page for
  as long as it is open, so it runs narrower and denser, on a laptop screen
  the page must keep enough room to work in.

  The app shell draws its content as a rounded card on the gray page ground:
  the header bar spans the full width on gray, and the content card below it
  has a rounded top-left corner with a muted hairline. When Langy docks
  inside that shell it joins the same language: the content card also rounds
  its top-right corner, and Langy becomes a SECOND card, same surface, same
  radius, same hairline, separated from the first by a strip of the page
  ground, starting below the header exactly like the content card does. The
  app header keeps the full viewport width, so there is no second header
  line to mis-align with. Pages that do not use the app shell (full-screen
  tools like the studio) keep the flush full-height dock: they have no gray
  ground or rounded card for Langy to pair with.

  Background:
    Given I am signed in with access to a project that has Langy

  Scenario: The docked sidebar is narrower than the floating card
    Given the Langy panel is open in floating mode
    When I switch the panel to sidebar mode
    Then the panel docks to the right edge at a narrower width than the floating card
    And page content shifts left so nothing sits under the panel

  Scenario: The docked sidebar is denser than the floating card
    Given the Langy panel is open in sidebar mode
    Then the conversation column uses tighter padding and message spacing than floating mode

  Scenario: Docking inside the app shell makes Langy a second content card
    Given a page that uses the app shell
    When the Langy panel opens in sidebar mode
    Then the panel starts below the app header, aligned with the content card's top edge
    And its top-left corner is rounded with the same radius as the content card
    And its edges facing the page carry the same muted hairline as the content card

  Scenario: The content card rounds its right corner while Langy is docked
    Given a page that uses the app shell
    When the Langy panel opens in sidebar mode
    Then the content card gains a rounded top-right corner and a right hairline
    And a strip of the page ground separates the two cards

  Scenario: The app header spans the full width while Langy is docked
    Given a page that uses the app shell
    When the Langy panel opens in sidebar mode
    Then the header bar keeps the full viewport width above both cards
    And only the content area below it reserves room for the docked panel

  Scenario: Pages without the app shell keep the flush dock
    Given a full-screen page that does not use the app shell
    When the Langy panel opens in sidebar mode
    Then the panel docks flush to the viewport edge at full height
    And the page reserves the panel's width so content is not covered

  Scenario: Closing the dock returns the page to full width
    Given the Langy panel is open in sidebar mode
    When I close the panel
    Then page content reclaims the full viewport width
    And the content card extends back to the viewport edge without right rounding

  Scenario: An open drawer turns Langy into its floating companion
    Given the Langy panel is open
    When a right-anchored drawer opens
    Then the panel holds the right edge as a floating card
    And the drawer slides in to the panel's LEFT, yielding the edge
    And the companion card wears exactly the drawer's chrome: height, radius, hairline, material and shadow
    And a strip of space separates the two cards, both above all content
    And the page content reclaims the dock's reserved width underneath

  @unit
  Scenario: The companion ride is choreographed, not a teleport
    Given the Langy panel is docked
    When a drawer opens
    Then the panel first slides off the right edge, exactly like a closing dock
    And the drawer and the companion then slide in from the right as one unit, holding their gap
    When the drawer closes
    Then the pair slides out to the right as one unit
    And the panel then slides back into its dock from the right, exactly like an opening dock

  @unit
  Scenario: Reduced motion re-seats the companion without the ride
    Given the reader prefers reduced motion
    When a drawer opens or closes beside the open panel
    Then the panel re-seats between dock and companion directly, with no travelling beats

  @unit
  Scenario: Opening Langy beside an already open drawer slides it in solo
    Given a drawer is open and the Langy panel is closed
    When the panel opens
    Then the companion slides in from the right edge on its own
    And the drawer eases left to yield the edge

  Scenario: Closing the drawer sends Langy back to its dock
    Given the Langy panel is riding beside an open drawer
    When the drawer closes
    Then the panel returns to where it was before the drawer opened
    And the dock's room is reserved again

  Scenario: Closing Langy mid-ride returns the drawer to the edge
    Given the Langy panel is riding beside an open drawer
    When the panel closes
    Then the drawer slides back to the viewport's right edge

  @integration
  Scenario: The companion offers a single close affordance
    Given the Langy panel is riding beside an open drawer
    Then the panel's header hides its own Close control
    And the drawer's own close is the only X on screen
    So closing the drawer, not Langy, is the obvious action
