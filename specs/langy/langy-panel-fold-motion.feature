Feature: Langy panel fold motion

  The Langy panel can wear a decorative "fold" — a soft luminous seam dividing
  the panel into two faint brand tones. Its motion is ambient signal, not
  spectacle: it reflects what Langy itself is doing and never what the user's
  cursor is doing, and it stays subtle in every state. A glance at the fold
  answers "is Langy idle, thinking, answering, or running a tool" without
  reading a word — motion changes carry information, they never demand
  attention.

  Background:
    Given I am signed in with access to a project that has Langy
    And the Langy panel is open with the fold effect

  Scenario: The fold ignores the cursor
    When I move my cursor across and around the panel
    Then the fold does not react to the cursor in any way

  Scenario: An idle panel barely moves
    Given no reply is in flight
    Then the fold drifts gently, almost still

  Scenario: Sending a message wakes the fold
    Given the panel is idle
    When I send a message
    Then a single gentle ripple travels down the fold
    And the fold returns to quiet motion while Langy starts up

  Scenario: Thinking reads as a slow swell
    Given Langy is reasoning about my question
    Then the fold moves as a slow deep swell
    And that swell is visibly calmer than the motion while Langy writes

  Scenario: A streaming answer is the liveliest state
    Given Langy is streaming its answer
    Then the fold moves with a livelier travelling motion than any other state
    And the motion stays subtle enough not to distract from reading the answer

  Scenario: A running tool reads as a steady pulse
    Given Langy is running a tool
    Then the fold breathes in a slow steady rhythm distinct from writing

  Scenario: A failed or recovering turn settles the fold
    Given the turn has failed or is quietly recovering
    Then the fold settles toward stillness
    And it never moves franticly

  Scenario: The end of a turn eases back to idle
    Given Langy has just finished its answer
    Then the fold eases back to its idle drift over a couple of seconds
    And it never snaps to a different motion

  Scenario: Rapid state changes never pop
    Given Langy alternates quickly between running tools and writing
    Then the fold blends smoothly between the two motions with no visible jumps

  Scenario: Both layouts share the same behaviour
    Given the panel effect is set to fold
    Then the fold behaves the same way in the floating card and the sidebar dock

  Scenario: The split effect calms down at rest
    Given the panel effect is set to split
    When no reply is in flight
    Then the black-and-white invert softens to a calmer veil
    And it returns to full strength while Langy is working

  Scenario: Reduced motion stills the fold
    Given my system asks for reduced motion
    Then the fold renders as a static resting curve and never animates
