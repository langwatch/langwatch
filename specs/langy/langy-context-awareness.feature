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
      | surface     | thing              |
      | traces      | trace row          |
      | traces      | open trace         |
      | evaluations | evaluation card    |
      | datasets    | dataset row        |
      | prompts     | published prompt   |
      | agents      | agent card         |
      | workflows   | workflow card      |
      | evaluators  | evaluator card     |
      | automations | automation row     |
      | annotations | annotation queue   |
      | annotations | queue item         |
      | simulations | simulation run     |
      | scenarios   | scenario row       |
      | experiments | experiment row     |
      | analytics   | dashboard card     |

  Scenario: A resource I pointed at is the same one I then opened
    Given the Langy panel is open on the workflows page
    When I absorb a workflow card
    And I open that workflow
    Then the composer shows one chip for it, not two

  # ── Pointing the other way: panel back to page ─────────────────────────────

  Scenario: Pointing at a chip in the panel shows me which card it means
    Given the Langy panel is open with context chips
    When I rest my pointer on a chip in the context list
    Then that chip's card lights up where it sits on the page
    And the light goes out when I move on

  Scenario: The same works from the # palette
    Given the Langy panel is open on a page with things Langy can use
    When I open the "#" palette and move down its rows
    Then the thing each row names lights up on the page as I reach it

  Scenario: Reading the context list is not entering the picking mode
    Given the Langy panel is open and I have not pressed "#"
    When I rest my pointer on a chip in the context list
    Then that chip's card still lights up where it sits on the page
    And the rest of the page is untouched — nothing else glows, and every row
      still opens the way it always did

  Scenario: Everything armed twinkles rather than pulsing in formation
    Given the Langy panel is open on a page with many things Langy can use
    When I press "#"
    Then each usable thing glimmers on its own timing
    And no two of them brighten in lockstep

  Scenario: I cannot point at things underneath a drawer
    Given the Langy panel is open on a page with things Langy can use
    When I open a drawer that covers the page
    Then the things behind the drawer do not glow
    And nothing behind the drawer can be absorbed by clicking through it

  # ── Finding the two palettes ────────────────────────────────────────────────

  Scenario: The composer says which key opens what
    Given the Langy panel is open
    Then the composer shows that "#" adds context and "/" picks a skill
    And clicking either one opens that palette without touching the keyboard

  Scenario: Each palette says which one it is
    Given the Langy panel is open
    When I open either palette
    Then it is titled with what it holds — "Context" or "Skills"
    And its rows are grouped under headings

  Scenario: Typing / lists what Langy can do
    Given the Langy panel is open
    When I type "/" in the composer
    Then the palette lists Langy's skills
    And picking one puts the question it answers into my message, ready to edit

  Scenario: The trigger key never lands in my message
    Given the Langy panel is open
    When I type "#" or "/" at the start of a message
    Then the palette opens and the character is not typed into the message

  Scenario: A mid-sentence hash or slash is left alone
    Given the Langy panel is open
    When I type a URL or a #tag in the middle of a sentence
    Then no palette opens and the character is typed normally

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

  Scenario: What lights up can be taken, which is what the palette promised
    Given I chose "Show datasets on this page" from the "#" palette
    When I point at one of the datasets that lit up
    Then an "Absorb context" button appears over it, as it does when I press "#"
    And clicking the row adds it as a chip instead of opening it
    And I can drag it onto the panel instead

  Scenario: An offer does not expire under the hand reaching for it
    Given the things I asked to see are lit up
    When I rest my pointer on one of them for longer than the light usually lasts
    Then it stays lit and stays takeable while I am pointing at it

  Scenario: The lights let go, and give the page straight back
    Given the things I asked to see are lit up
    When I do not take any of them
    Then the lights fade by themselves
    And the rows go back to opening the way they always did

  Scenario Outline: Every kind I can name lands somewhere it can be taken from
    Given the Langy panel is open on a page with none of them
    When I type "#" and then "<kind>"
    Then the palette offers to browse <kind>
    And choosing it opens a page whose <thing> can be absorbed as context
    Examples:
      | kind        | thing            |
      | datasets    | dataset row      |
      | prompts     | published prompt |
      | evaluations | evaluator card   |
      | simulations | simulation run   |
      | experiments | experiment row   |
      | workflows   | workflow card    |
      | agents      | agent card       |
      | automations | automation row   |
      | annotations | annotation queue |
      | dashboards  | dashboard card   |

  Scenario: A first-time hint teaches the gesture once
    Given I have never absorbed anything into Langy
    When I open the Langy panel on a page with things Langy can use
    Then a single dismissible hint above the composer explains the gesture
    And the hint mentions both pressing "#" and dragging a thing onto Langy

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

  # ── Nothing follows me somewhere else ──────────────────────────────────────
  #
  # Langy survives navigation on purpose — the panel, the half-typed question and
  # an answer still streaming all stay put as you move between pages. That is the
  # same mechanism that would carry one customer's resources into another's
  # composer, so the boundary is drawn deliberately, and it is drawn around WHO
  # and WHERE, not just where.

  Scenario Outline: What I gathered stays where I gathered it
    Given I absorbed a trace into Langy on a project
    When I <move>
    Then Langy no longer offers that trace as context
    And my half-typed question, my chosen chips and my model choice are gone too
    Examples:
      | move                                            |
      | open a different project                        |
      | switch to a different organization              |
      | sign in as somebody else on that same project   |

  Scenario: A project I come back to is where I left it
    Given I was in the middle of a conversation on a project
    When I reload the page on that same project, as that same person
    Then the conversation I was in opens again, with its history

  Scenario: The same place announced twice is not somewhere else
    # The scope is re-announced on every refetch — regaining window focus is
    # enough. That is a heartbeat, not a move, and it must not sweep anything.
    Given I absorbed a trace into Langy on a project
    When I switch to another window and come back to that same project
    Then the trace is still attached as context
    And my half-typed question is still in the composer

  Scenario: Starting a new chat starts on nothing
    Given I absorbed a trace into Langy
    When I start a new chat
    Then Langy no longer offers that trace as context
    But the things on the page can still be pointed at and absorbed

  Scenario: What I grabbed rides into the question I ask from elsewhere
    # Arm, absorb, ask is the ordinary order of the gesture — the ask field on
    # the home page and the command bar both start a fresh conversation, but
    # the context the user JUST assembled is for that very question.
    Given I absorbed a trace into Langy
    When I ask Langy a question from the home field or the command bar
    Then the trace rides along as context on that question
    And the composer shows its chip, where I can still remove it

  Scenario: How I like the panel is not something I gathered
    Given I have set the panel's layout and dismissed the context hint
    When I open a different project
    Then the panel keeps the layout I chose
    And the hint I already dismissed does not come back
