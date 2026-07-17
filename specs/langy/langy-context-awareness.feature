Feature: Langy lights up what it can use as context ("glow and go")
  As a LangWatch user with the Langy panel open
  I want the things on the page Langy can work with to light up quietly as I point at them
  So that I can hand Langy exactly what I am looking at without typing an id

  # Companion to langy-context-system.feature, which covers the composer's
  # context chips and how they ride along with a turn. This file covers the
  # page side: what lights up, when, how a thing on the page becomes a chip,
  # and how the gesture is taught.
  #
  # The standing constraint on everything here: not too distracting, not too
  # subtle, never annoying. Concretely — nothing on the page changes while the
  # panel is closed; targets light up around the pointer instead of all at
  # once; the highlight never moves the page by a pixel; and the teaching
  # surfaces show up once, then get out of the way.

  Background:
    Given I am signed in to LangWatch on a project

  Scenario: The page is untouched while the Langy panel is closed
    Given the Langy panel is closed
    When I browse any page
    Then nothing on the page glows, pulses, or offers itself to Langy

  Scenario: Things near my pointer light up quietly
    Given the Langy panel is open on a page with things Langy can use
    When I move my pointer around the page
    Then the usable things near my pointer pick up a faint glow
    And things far from my pointer stay unlit

  Scenario: Hovering something usable offers to add it
    Given the Langy panel is open
    When I rest my pointer on a usable thing
    Then its glow firms up
    And an "Absorb context" button appears over it

  Scenario: Absorbing a thing adds it to the conversation's context
    Given I am hovering a trace row with the Langy panel open
    When I click "Absorb context"
    Then a chip for that trace appears in the composer
    And the row stays visibly marked as added while the panel is open

  Scenario: Absorbing the same thing again releases it
    Given a trace I absorbed is marked as added
    When I click its button again
    Then its chip leaves the composer
    And the mark comes off the row

  Scenario: The page keeps working while things glow
    Given the Langy panel is open
    When I click a glowing trace row itself, not its "Absorb context" button
    Then the row opens its drawer exactly as it does with the panel closed

  Scenario: I can gather several things one after another
    Given the Langy panel is open
    When I absorb a trace, then a dataset, then an evaluation
    Then the composer shows a chip for each one

  Scenario Outline: Usable things light up across the platform
    Given the Langy panel is open on the <surface> page
    Then each <thing> can light up and be absorbed as context
    Examples:
      | surface     | thing            |
      | traces      | trace row        |
      | traces      | open trace       |
      | evaluations | evaluation card  |
      | datasets    | dataset row      |
      | prompts     | published prompt |

  Scenario: A table selection travels as one item, not one chip per row
    Given I have selected several rows in the traces table
    When the Langy panel is open
    Then the selection appears as a single "traces selected" chip
    And sending a message hands Langy exactly those rows

  Scenario: My current search travels as one item
    Given I have filtered the traces table
    When the Langy panel is open
    Then the filter appears as a single chip describing the search
    And sending a message hands Langy the search itself, not a list of rows

  Scenario: Typing # lists what is on the page
    Given the Langy panel is open on a page with things Langy can use
    When I type "#" in the composer
    Then the palette lists the things on the page that can be added
    And picking one adds it as a chip without touching the pointer

  Scenario: Typing a kind of thing into # shows me where those things are
    Given the Langy panel is open on the traces page
    When I type "#" and then "traces"
    Then the palette offers to show the traces on this page
    And choosing it lights the trace rows up for a moment

  Scenario: Typing a kind of thing that is not on this page takes me to it
    Given the Langy panel is open on the datasets page
    When I type "#" and then "traces"
    Then the palette offers to browse traces
    And choosing it opens the traces page
    And the trace rows light up for a moment as they appear

  Scenario: A first-time hint teaches the gesture once
    Given I have never absorbed anything into Langy
    When I open the Langy panel on a page with things Langy can use
    Then a single dismissible hint above the composer explains the gesture

  Scenario: The hint never returns after I dismiss it
    Given I dismissed the context hint
    When I open the Langy panel again, on any page, any day
    Then the hint does not appear

  Scenario: Doing the thing retires the hint by itself
    Given the context hint is showing
    When I absorb my first thing into Langy
    Then the hint goes away and never returns

  Scenario: No hint on a page with nothing to point at
    Given I am on a page with nothing Langy can use
    When I open the Langy panel
    Then no hint appears

  Scenario: Reduced motion swaps the shimmer for a still highlight
    Given my system asks for reduced motion
    When usable things light up near my pointer
    Then the highlight is steady, with no shimmer or animation
    And every state still reads: near, hovered, and added
