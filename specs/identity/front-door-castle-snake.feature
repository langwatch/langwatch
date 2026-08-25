Feature: The castle Snake - a way to waste a minute at our front door
  As somebody who noticed the castle and poked it twice
  I need a small game that runs on the ground already behind the sign-in card
  So that finding it is a reward, and never finding it costs nothing at all

  # A rider on D13 (ADR-117), inside the same flag and on the same screens.
  # Entirely client-side and self-contained: no route, no request, no record,
  # nothing stored. It exists to be found.
  #
  # The board is the ground's own signal grid - the 72px lattice
  # `lw-front-door-signal-grid` already draws - and the snake runs along the
  # LINES of it rather than through the cells. It eats tokens. A small and
  # visibly unwell molecule gives chase, one step for every three of the
  # snake's, which is the whole difficulty curve.
  #
  # The bar this has to clear is that it must never cost anybody anything who
  # did not go looking for it. It cannot start by accident, it cannot take a
  # click, it cannot move a pixel of the card, and it gives every key back the
  # moment it stops.

  Background:
    Given a hosted deployment with the front door enabled

  # Nothing on the page hints at this, which is the point: an easter egg that
  # announces itself is a feature nobody asked for. A double-tap is deliberate
  # in a way a click is not, and the castle is the one thing on the page that
  # is purely ours to play with.
  @integration
  Scenario: The castle opens on a double-tap and on nothing else
    When I double-tap the LangWatch castle
    Then a game of Snake starts on the ground behind the card
    And a single click on the castle starts nothing
    And a double-tap anywhere else on the page starts nothing

  # The reason this is allowed to exist on a page where people are trying to
  # log in. The canvas is out of flow and takes no pointer events, so there is
  # no arrangement of the game that can come between somebody and the form.
  @integration
  Scenario: The game never comes between anybody and the card
    Given a game of Snake is running
    Then the card keeps every pixel and every click it had
    And the game takes no clicks of its own
    And stopping the game leaves the page exactly as it found it

  # Arrows are borrowed, not taken: only while a game is actually running, and
  # given straight back when it stops. Escape is the way out, and it is the
  # only way out that has to be discovered - it is the one everybody tries.
  @integration
  Scenario: Escape puts it away and returns the keyboard
    Given a game of Snake is running
    When I press Escape
    Then the game stops and the ground is left as it was
    And the arrow keys behave as they did before it started

  # Reduced motion asks not to be moved AT. It does not ask a game somebody
  # just started to sit still, so this one keeps playing while everything
  # ambient on the page stays stood down.
  @integration
  Scenario: A deliberately started game still plays under reduced motion
    Given I have asked for less motion
    When I double-tap the LangWatch castle
    Then the game plays
    And the entrance, the warp and the rise all stay stood down

  # The rules, checked without a canvas.
  @unit
  Scenario: The snake runs the lattice and grows on a token
    Given a snake running along the grid lines
    When its head reaches a token
    Then it grows by one and another token appears somewhere free
    And following its own tail is allowed, because the tail is leaving

  @unit
  Scenario: The ground has no walls
    Given a snake at the edge of the lattice
    When it keeps going
    Then it comes back on the opposite edge
    And the molecule takes the short way round after it

  @unit
  Scenario: A fumbled key is not a death sentence
    Given a snake travelling right
    When I ask it to turn back on itself
    Then the request is dropped and the snake carries on
    And a turn asked for twice inside one tick cannot fold it through its neck

  @unit
  Scenario: The molecule catches the snake
    Given the molecule one step from the snake
    When it takes that step
    Then the game ends
    And nothing moves again until the game is started afresh
