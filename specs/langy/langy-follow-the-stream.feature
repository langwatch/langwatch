Feature: The Langy conversation follows the stream

  An answer arrives a token at a time, so the message column has to keep the
  live edge in view while it grows. It follows only while the reader is at the
  bottom: the moment they scroll up to read something, the column stops moving
  under them, and a "Jump to latest" pill offers the way back. Arriving at the
  bottom again, by the pill or by hand, resumes the follow.

  The column also moves on its own. A turn finishes and its live parts are
  replaced by the recorded ones, a status line goes away, a card collapses.
  When content is removed the browser clamps the scroll position down to the
  new maximum, and that looks exactly like a reader scrolling up. Reading it as
  one stopped the follow for the rest of the conversation and left a pill in
  front of a reader who never scrolled. Only input that can move the column up,
  a wheel turned up, an up key, a finger dragging up, or the scrollbar, stops
  the follow.

  Background:
    Given I am signed in with access to a project that has Langy

  Rule: The column follows the live edge while the reader is at the bottom

    @integration
    Scenario: An answer that grows keeps its newest line in view
      Given the Langy panel is open and scrolled to the bottom
      When the answer grows
      Then the column follows it and the newest line stays in view

    # The column grows from several sources that never touch the message list:
    # tokens, turn status, progress, and the capability cards. Following the
    # message list alone let the answer stream off the bottom of the panel.
    @integration
    Scenario: Anything that makes the column taller is followed
      Given the Langy panel is open and scrolled to the bottom
      When the column grows without the message list changing
      Then the column follows it and the newest line stays in view

  Rule: Only the reader stops the follow

    @integration
    Scenario: Scrolling up to read stops the column moving
      Given the Langy panel is open and an answer is streaming
      When I scroll up to read
      Then the column stops following, and offers to jump to the latest

    @integration
    Scenario: Returning to the bottom resumes the follow
      Given I scrolled up while an answer was streaming
      When I scroll back to the bottom
      Then the column follows the answer again

    # The failure this rule exists for: the reader watches the whole turn, never
    # touches the scroll, and the panel still stops following and shows the pill.
    @integration
    Scenario: The column rearranging itself does not stop the follow
      Given the Langy panel is open and scrolled to the bottom
      When the column jumps upward with no scroll gesture behind it
      Then the column keeps following, and offers nothing to jump to

    @integration
    Scenario: The follow survives the rearrangement
      Given the column jumped upward with no scroll gesture behind it
      When the answer grows again
      Then the column follows it and the newest line stays in view

    # A reader already at the live edge who flicks further DOWN moves nothing,
    # and it is the commonest gesture in a streaming column. Counting it as
    # input excuses the finalisation clamp that lands next, which is the same
    # failure again, reached by the ordinary path instead of the rare one.
    @integration
    Scenario: A gesture that cannot move the column up does not stop the follow
      Given the Langy panel is open and scrolled to the bottom
      When I scroll further down, and then the column jumps upward on its own
      Then the column keeps following, and offers nothing to jump to

    @integration
    Scenario: Dragging the column up with a finger stops the follow
      Given the Langy panel is open and an answer is streaming
      When I drag the column up with a finger
      Then the column stops following, and offers to jump to the latest

    # The scrollbar is the one gesture with no direction to read, so it gets the
    # benefit of the doubt: the column is following the hand, and pulling it
    # back to the live edge mid-drag would be fighting the reader.
    @integration
    Scenario: Dragging the scrollbar up stops the column moving
      Given the Langy panel is open and an answer is streaming
      When I drag the scrollbar up
      Then the column stops following, and offers to jump to the latest

    # A press on the message text is a click or a selection, and it reaches the
    # column the same way the scrollbar does. Neither moves the column, so
    # neither may excuse what the column does to itself next.
    @integration
    Scenario: Selecting text in the column does not stop the follow
      Given the Langy panel is open and scrolled to the bottom
      When I select text in the answer, and then the column jumps upward on its own
      Then the column keeps following, and offers nothing to jump to

    @integration
    Scenario: A selection dragged above the column stops the follow
      Given the Langy panel is open and an answer is streaming
      When I select text and drag above the top of the column
      Then the column stops following, and offers to jump to the latest

    # Following is a smooth scroll, and a smooth scroll reports every position
    # it passes through. Each one is "not at the bottom yet", so reading them as
    # the reader's own would stop the follow on the very movement that was
    # honouring it, and the column would follow exactly one token.
    @integration
    Scenario: The column's own movement does not stop the follow
      Given the Langy panel is open and scrolled to the bottom
      When the column is part way through following the answer
      Then it keeps following to the end
