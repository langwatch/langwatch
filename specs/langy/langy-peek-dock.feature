Feature: Langy minimised peek

  Minimising Langy does not hide the panel and put something else in its
  place. The PANEL ITSELF slides down (floating) or right (sidebar) until only
  a sliver of its own header shows, and slides back when you open it. One
  element, one continuous motion — what peeks is literally the top of the
  panel, its own header and surface and hairline, not a stand-in that looks
  like it. Two elements trading places can never read as one object moving;
  that swap is what made the old shape look like something popping in and out.

  Three positions on one axis:
    rest       a thin sliver at the viewport edge; overlays the page, never
               reserves room, never shifts layout.
    proximity  the pointer nears the sliver (or it takes keyboard focus): the
               same element travels a little further — an invitation, not an
               opening.
    open       a click, Enter/Space, or the existing Cmd/Ctrl+I: the panel
               finishes the same journey and is simply itself again.

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
    Then the panel slides down until only a sliver of its own header shows above the bottom viewport edge
    And it is the same element that was open — nothing was swapped in for it
    And the conversation, draft and layout choice are untouched underneath
    And the page shifts by nothing — the peek overlays, it never pushes

  Scenario: Minimising the docked panel leaves a sliver on the right edge
    Given the Langy panel is open in sidebar mode
    When I minimise the panel
    Then the dock's room is released and page content reclaims the full width
    And the dock slides right until only a thin sliver of its own spine shows at the right edge

  Scenario: The peek rises as the pointer approaches
    Given the Langy panel is minimised
    When the pointer nears the peek's edge region
    Then the same element travels a little further into view, inviting the click
    And it settles back to its resting sliver when the pointer moves away

  Scenario: Clicking the peek opens the panel
    Given the Langy panel is minimised
    When I click the peek
    Then the panel finishes the same slide and is fully open in whichever layout I use
    And it is the same element throughout — it is never unmounted and remounted
    And nothing of the peek's offset is left behind once it is open

  Scenario: Opening from the peek grows the panel without distorting its content
    Given the Langy panel is minimised to its peek
    When I open it
    Then the panel expands by moving and resizing, with its content laid out at final size throughout
    And nothing inside the panel stretches, squashes, or snaps into place after the motion

  Scenario: The peek is a keyboard citizen
    Given the Langy panel is minimised
    When I Tab to the peek
    Then it rises to its proximity height so I can see what I focused
    And Enter or Space opens the panel

  Scenario: The command activation works regardless of the pointer
    Given the Langy panel is minimised
    When I press the Langy keyboard activation
    Then the panel opens fully, exactly as it does from the peek's own click

  Scenario: Reduced motion drops the travel, not the affordance
    Given I prefer reduced motion
    And the Langy panel is minimised
    Then no pointer-proximity tracking runs at all
    And hovering or focusing the peek moves it to the raised position without animating
    And minimising and opening arrive at their positions without an eased slide

  Scenario: The peek shows the turn still running under it
    Given a Langy turn is in flight
    When I minimise the panel
    Then the sliver's brand seam breathes quietly until the turn settles
    So the work I walked away from is visibly still alive

  Scenario: A drawer moves the floating peek out of its way
    Given the Langy panel is minimised in floating mode
    When a right-anchored drawer opens
    Then the peeking panel rests along the bottom-LEFT edge, clear of the drawer and the table pager

  Scenario: The sidebar peek holds the right edge above an open drawer
    Given the Langy panel is minimised in sidebar mode
    When a right-anchored drawer opens
    Then the sliver stays on the right edge, riding above the drawer's card
    And at rest it is thin enough to sit on the drawer's rim without hiding content

  # The panel is mounted whether it is open, peeking or hidden — that is what
  # keeps an in-flight answer alive when you minimise. Peeking must therefore
  # not become a way to leave a live panel on screen doing work you cannot see.

  Scenario: A peeking panel is inert behind its edge
    Given the Langy panel is minimised
    Then the only thing I can reach in it is the control that opens it
    And Tab does not walk into the composer or the conversation behind the edge
    And a screen reader is not read a conversation that is not on screen

  Scenario: The rollout flag falls back to the launcher orb
    Given the Langy peek rollout flag is disabled for me
    When I minimise the panel
    Then the panel is hidden outright, as it always was
    And the corner launcher orb is what opens it again
    And exactly one minimised affordance is ever on screen
