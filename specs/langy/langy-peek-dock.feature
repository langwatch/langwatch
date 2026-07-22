Feature: Langy minimised peek

  Minimising Langy no longer collapses it to a corner orb. The panel sinks to
  a PEEK: in floating mode the card slips below the bottom viewport edge with
  just a sliver of its header lip showing, bottom-right where the card lives;
  in sidebar mode the dock's spine peeks in from the right edge as a thin
  vertical sliver, mid-height. The peek is the SAME creature at rest — it
  wears the panel's surface, hairline and brand seam, and rises on the
  panel's own motion curve — so minimise reads as the card sinking out of
  the way, not as the panel being swapped for a button.

  Three states, one direction of travel:
    rest       a small sliver at the viewport edge; overlays the page, never
               reserves room, never shifts layout.
    proximity  the pointer nears the peek's edge region (or the peek takes
               keyboard focus): it rises a little further — an invitation,
               not an opening.
    open       a click, Enter/Space on the focused peek, or the existing
               Cmd/Ctrl+I activation: the panel opens fully on its existing
               spring; the peek stands down.

  # Rollout: the peek replaces the corner launcher orb behind
  # release_ui_langy_peek_dock_enabled. Flag off keeps the orb; exactly one
  # minimised affordance renders at a time, and only the closed state
  # differs — the open panel and the Cmd/Ctrl+I activation are identical on
  # either side of the flag.

  Background:
    Given I am signed in with access to a project that has Langy
    And the Langy peek rollout flag is enabled for me

  Scenario: Minimising the floating panel sinks it to a bottom peek
    Given the Langy panel is open in floating mode
    When I minimise the panel
    Then a sliver of the card's header lip rests above the bottom viewport edge, bottom-right
    And the conversation, draft and layout choice are untouched underneath
    And the page shifts by nothing — the peek overlays, it never pushes

  Scenario: Minimising the docked panel leaves a sliver on the right edge
    Given the Langy panel is open in sidebar mode
    When I minimise the panel
    Then the dock's room is released and page content reclaims the full width
    And a thin vertical sliver of the dock's spine peeks in from the right edge, mid-height

  Scenario: The peek pops closer as the pointer approaches
    Given the Langy panel is minimised
    When the pointer nears the peek's edge region
    Then the peek rises further into view, inviting the click
    And it settles back to its resting sliver when the pointer moves away

  Scenario: Clicking the peek opens the panel
    Given the Langy panel is minimised
    When I click the peek
    Then the panel opens fully in whichever layout I use
    And the open rides the panel's existing motion, rising from where the peek rested

  Scenario: The peek is a keyboard citizen
    Given the Langy panel is minimised
    When I Tab to the peek
    Then it rises to its proximity height so I can see what I focused
    And Enter or Space opens the panel

  Scenario: The command activation works regardless of the pointer
    Given the Langy panel is minimised
    When I press the Langy keyboard activation
    Then the panel opens fully, exactly as it does from the peek's own click

  Scenario: Reduced motion trades the pop for a plain hover state
    Given I prefer reduced motion
    And the Langy panel is minimised
    Then no pointer-proximity tracking runs at all
    And hovering or focusing the peek itself swaps it to the raised state without animation
    And minimise and open cross-fade instead of sliding

  Scenario: The peek shows the turn still running under it
    Given a Langy turn is in flight
    When I minimise the panel
    Then the peek's brand seam breathes quietly until the turn settles
    So the work I walked away from is visibly still alive

  Scenario: A drawer moves the floating peek out of its way
    Given the Langy panel is minimised in floating mode
    When a right-anchored drawer opens
    Then the peek rests along the bottom-LEFT edge, clear of the drawer and the table pager

  Scenario: The sidebar peek holds the right edge above an open drawer
    Given the Langy panel is minimised in sidebar mode
    When a right-anchored drawer opens
    Then the sliver stays on the right edge, riding above the drawer's card
    And at rest it is thin enough to sit on the drawer's rim without hiding content
