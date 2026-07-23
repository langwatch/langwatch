Feature: Langy panel layout modes

  The Langy panel has two user-picked layouts: a sidebar dock attached to the
  right edge that reserves room so page content is never covered (the
  default), and a floating card that overlays the page. The floating card overlays content, so it
  can afford to be wide; the docked sidebar takes its width FROM the page for
  as long as it is open, so it runs narrower and denser, on a laptop screen
  the page must keep enough room to work in.

  The app shell is a flat console frame: a full-height navigation rail on
  the left and an edge-to-edge workspace beside it. When Langy docks it
  joins that language as a flush full-height pane on the viewport's right
  edge, separated from the page by a hairline — the same geometry on shell
  pages and on full-screen tools without the shell, so the dock never
  changes shape as the user moves between them. Only the floating card
  overlays and rounds; the dock is always a pane.

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

  Scenario: The dock is a flush full-height pane on every page
    When the Langy panel opens in sidebar mode
    Then the panel docks flush to the viewport's right edge at full height
    And a hairline separates it from the page
    And the page reserves the panel's width so content is not covered
    And the geometry is the same on app-shell pages and full-screen tools

  Scenario: The navigation rail is untouched while Langy is docked
    Given a page that uses the app shell
    When the Langy panel opens in sidebar mode
    Then the navigation rail keeps its full height and width
    And only the content column reserves room for the docked panel

  Scenario: Closing the dock returns the page to full width
    Given the Langy panel is open in sidebar mode
    When I close the panel
    Then page content reclaims the full viewport width

  # The morph idiom is not only panel-to-panel. The home page's lit block is
  # an ORIGIN for it: its composer is the same object as the panel's, so
  # sending from home seats that object into whichever layout is in use rather
  # than opening the panel beside a box that just vanished. The travel itself
  # is specified in specs/home/langy-home-morph.feature.

  Scenario: The home page's composer is an origin for the panel's morph
    Given the Langy home renders and the panel is closed
    When I send a question from the home page's composer
    Then the panel opens in whichever layout I use
    And the composer seats itself on that panel's floor as one continuous object
    And the panel is not remounted, so nothing in flight is torn down

  # Opening a drawer does something DIFFERENT per layout, so docked and
  # floating stay visibly distinct.

  Scenario: A drawer turns the DOCKED panel into its floating companion
    Given the Langy panel is open in sidebar mode
    When a right-anchored drawer opens
    Then the panel MORPHS in place to the right edge as a floating card: it grows taller and lifts above all content, it does not slide off-screen and back
    And the companion card wears exactly the drawer's chrome: height, radius, hairline, material and shadow
    And the drawer keeps its own slide-in but starts from BEHIND the companion card, which sits above it at a higher z-index
    And a strip of space separates the two cards, both above all content
    And the page content reclaims the dock's reserved width underneath

  Scenario: A drawer makes the FLOATING panel dodge to the left
    Given the Langy panel is open in floating mode
    When a right-anchored drawer opens
    Then the floating panel hops to the LEFT corner, out of the drawer's way
    And the drawer keeps the full right edge, it does not yield
    And the drawer's entrance is held back briefly so the panel clears out first
    And the panel keeps its own Close, the two cards being far apart

  Scenario: Closing the drawer sends the docked companion back to its dock
    Given the Langy panel is riding beside an open drawer
    When the drawer closes
    Then the panel morphs back to where it was before the drawer opened
    And the dock's room is reserved again

  Scenario: Closing Langy mid-ride returns the drawer to the edge
    Given the Langy panel is riding beside an open drawer
    When the panel closes
    Then the drawer returns to the viewport's right edge

  @integration
  Scenario: The docked companion offers a single close affordance
    Given the Langy panel is riding beside an open drawer as the docked companion
    Then the panel's header hides its own Close control
    And the drawer's own close is the only X on screen
    So closing the drawer, not Langy, is the obvious action

  # The closed state is a PEEK of the panel itself, not a separate launcher —
  # see specs/langy/langy-peek-dock.feature for its states and geometry.
  Scenario: The minimised peek dodges the drawer
    Given the Langy panel is minimised in floating mode and a right-anchored drawer is open
    Then the peek sliver rests along the bottom-LEFT edge, clear of the drawer and the table pager
