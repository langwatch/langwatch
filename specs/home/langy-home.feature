@unit
Feature: The Langy home
  As a project member who has Langy
  I want the home page to open with a place to ask
  So that the first thing I meet is a way into my own work, not a lobby

  One lit block sits at the top of the home page. It owns the announcement
  surface's moving canvas, wears the current announcement as a single line of
  chrome across its top, sets a real Langy composer into its lower edge, and
  offers a short row of example asks beneath it. The rest of the home page
  continues underneath in the order it already has.

  The block only ever renders on the shared announcement canvas: it layers
  over it and never mounts a second one.

  Which home renders is resolved in a strict order, specified in
  specs/home/signal-focused-home-rollout.feature: the signal-focused home
  first, then this one, then the classic home. This feature covers the second
  branch and what the block contains. The send animation and its states are
  specified in specs/home/langy-home-morph.feature.

  Background:
    Given I am signed in on a project's home page

  Scenario: The Langy home renders when the signal-focused home is off
    Given I have Langy
    But the signal-focused home is not enabled for me
    When the home page renders
    Then the lit block leads the page with a composer I can type into
    And recent work and the setup checklist still follow underneath

  # Having Langy IS having the Langy home — there is no second rollout to
  # forget. A project with the panel and a classic lobby was a state nobody
  # could explain from the page, so it is no longer a state.
  Scenario: Without Langy the classic home renders
    Given I do not have Langy
    And the signal-focused home is not enabled for me
    When the home page renders
    Then the classic home renders
    And the lit block is not shown

  Scenario: The Langy home carries an announcement about Langy
    Given the Langy home renders
    Then the announcements include one about what Langy can do
    And it is an announcement, never an invitation to try Langy
    And following it starts that conversation in place, without leaving the page

  Scenario: That announcement is not shown to readers without Langy
    Given the classic home renders
    Then no announcement about Langy is carried
    Because an announcement about something I cannot reach is only noise

  Scenario: The block layers over the shared announcement canvas
    Given the Langy home renders
    Then the announcement's moving canvas is the block's own ground
    And exactly one such canvas is on the page
    And the current announcement reads as a single line across the block's top

  # The results carry a line above them in the raised Cmd+K bar, where the
  # field and the list share one card and the line is the boundary between
  # them. Here the results are their own panel under the field, so that line
  # became a second edge a few pixels inside the panel's own.
  Scenario: The results panel draws one edge, not two
    Given the Langy home renders
    When I type into the field
    Then the results hang under it as one panel with one border
    And no further line runs above the first group

  Scenario: The example asks are the ones Langy actually offers
    Given the Langy home renders
    Then the row beneath the composer offers three example asks
    And each one is an ask the assistant already offers when it has nothing to show
    And choosing one sends it, rather than filling the box in for me

  Scenario: The asks grow with what the project can act on
    Given the Langy home renders
    When the project has only traces
    Then the asks are the ones traces alone can answer
    When the project also has evaluations
    Then an ask about what is failing them is offered
    When the project also has runs to compare
    Then comparing them leads the row
    And no ask about getting started is offered any more

  Scenario: The asks never change under the reader's hand
    Given the Langy home renders
    And what the project holds is not known yet
    Then no example asks are shown
    And they appear once, already correct, rather than being swapped out

  Scenario: A reader who cannot start a conversation is not handed a composer
    Given the Langy home renders
    But I may read Langy without starting conversations
    Then no composer is offered
    And one quiet line tells me how to get access
    And the example asks are not shown

  Scenario: A project with nothing in it yet still opens with the composer
    Given the Langy home renders
    And the project has never received a trace
    Then the lit block still leads the page
    And the example asks become ways to get set up
    And the setup checklist takes the figures' place directly beneath the block
    And no figures or recent work are shown

  # The home is where a new project lands first, so the way in lives under the
  # field even though every empty feature page carries its own setup control.
  Scenario: A new project leads with sending the first trace
    Given the Langy home renders
    And the project has never received a trace
    Then a prominent send-your-first-trace control sits above the example asks
    And it offers the same routes in the same order as every empty page: the
      prompt for my coding agent first, Langy's walkthrough second, the docs third
    And the prompt it copies is the tracing skill, led by the project's keys,
      falling back to the install line while the skill is still on its way
      (specs/skills/empty-state-skill-setup.feature)
    And the walkthrough route is withheld when I cannot start conversations
    And the control's glyphs count the routes it opens with

  Scenario: A populated project keeps the quiet onboarding route
    Given the Langy home renders
    And the project has received traces
    Then a quiet onboard-your-agent control sits beneath the example asks
    And no send-your-first-trace lead appears
    And nothing is offered while what the project holds is not known yet

  Scenario: A project with data leads its figures with the compact strip
    Given the Langy home renders
    And the project has received traces
    Then the figures read as one compact row beneath the block
    And the full chart is one click away, not gone
    And recent work and the setup checklist follow in their usual order

  Scenario: Every figure says what window it covers
    Given the Langy home renders its figures
    Then the window those figures cover is shown with them
    And the control that opens the trend names that window too
    So that no figure can be read as covering all time

  Scenario: A window too short to have a trend does not draw one
    Given the Langy home renders its figures
    And the chosen window holds only one reading
    Then no chart is offered
    And one line invites me to widen the range instead

  Scenario: The reader can reach the guided docs from this home
    Given the Langy home renders
    Then the docs and guides section is on the page
    And the footer's quiet resource links are still there too

  Scenario: Developers can preview every state of this home
    Given the app is running a development build
    When I use the home state control in the page footer
    Then I can pin the page to any state the block can be in
    And I can compare the ways the figures can be presented, side by side over time
    And I can return it to the project's real data
    And the control is never rendered in production builds
