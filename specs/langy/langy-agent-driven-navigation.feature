Feature: Langy opens the resource it surfaced in the browser
  As a LangWatch user asking Langy to show me a resource
  I want Langy to open that resource in my browser, in place
  So that "show me one of the scenario runs" lands me on the run instead of handing me a link to click

  # Today Langy can only render a capability card with a clickable "Open in
  # <surface>" link — the USER must click; the agent cannot drive navigation.
  # This spec adds an agent-initiated navigate instruction that rides the live
  # turn stream, and first fixes the deep-link gaps that would make even the
  # destination wrong:
  #
  #   1. the scenario card links to the simulations INDEX, not the run it shows;
  #   2. the platform's own per-resource link (`platformUrl` on the CLI tool
  #      envelope) is ALSO the index for simulation runs — no layer today can
  #      address a specific run (the fix: the run-detail drawer on the
  #      simulations route, `/simulations?drawer.open=scenarioRunDetail&
  #      drawer.scenarioRunId={runId}` — the same address the app's own UI
  #      produces, needing only the run id);
  #   3. no card consumes `platformUrl` — the frontend rebuilds a weaker href
  #      and discards the platform's.
  #
  # There is ONE source of truth for a resource's address: the platform
  # computes it server-side, per resource. Cards render it; the navigate
  # instruction carries it. The agent only ever says WHICH resource to open —
  # it never authors an address, and any address it might author is ignored.
  # In-app rendering strips the platform link to a project-relative path so it
  # rides the SPA router: the persistent Langy panel
  # (specs/langy/langy-navigation-persistence.feature) survives the move with
  # its conversation intact.
  #
  # Navigation is a deliberate agent intent ("show me…", "open…", "take me
  # to…"), never a side effect of merely surfacing a resource. It is a
  # live-edge instruction: it fires at most once per instruction, never on
  # stream-tail replay after a reconnect, and never when reopening a past
  # conversation.
  #
  # See specs/langy/langy-capability-cards.feature (what a card renders),
  # specs/langy/langy-cli-tool-envelope.feature (how a CLI call becomes a typed
  # capability), and specs/langy/langy-card-taxonomy.feature.

  Background:
    Given I am signed in to LangWatch on a project
    And I have opened the Langy panel

  # ---------------------------------------------------------------------------
  # Prerequisite: the platform computes one true per-resource address
  # ---------------------------------------------------------------------------

  Rule: The platform's link for a resource addresses that resource, not an index

    @integration
    Scenario: The platform link for a simulation run lands on that run
      When the platform computes the link for a specific scenario run
      Then following the link lands on that run's detail view
      And not on the simulations index page

    @unit
    Scenario: A simulation run's address opens the run's own detail drawer
      When the platform builds the address for a scenario run
      Then the address opens that run's detail drawer on the simulations route
      And it is the same address the app's own UI produces for that run

    @unit
    Scenario: Every run gets a precise address, even when its set is unknown
      When the platform builds the address for a run whose scenario set is not resolved
      Then the address still opens that run's own detail drawer
      And it never degrades to the simulations index

  Rule: A card's open link is the platform's link for the resource it shows

    @integration
    Scenario: A scenario card links to the run it shows, not the simulations list
      When Langy fetches one scenario run and shows its card
      Then the card's open link targets that specific run
      And not the simulations index page

    @integration
    Scenario: A card prefers the platform link over a rebuilt one
      When a LangWatch CLI result carries the platform's own link to the resource
      Then the card's open action uses that link
      And the frontend does not substitute a rebuilt index-page link for it

    @integration
    Scenario: Opening a card's platform link stays in the app
      When I click a card's open link for a resource on this LangWatch instance
      Then the move uses in-app navigation, not a full page load
      And the Langy panel stays mounted

    @unit
    Scenario: A link pointing outside this LangWatch instance is not adopted
      When a CLI result carries a link that does not belong to this LangWatch instance
      Then the card falls back to the link it builds itself
      And the foreign link is never rendered as the card's open action

  # ---------------------------------------------------------------------------
  # Agent-driven navigation: deliberate, intent-gated
  # ---------------------------------------------------------------------------

  Rule: Langy navigates only when I asked to be taken somewhere

    @integration
    Scenario: Asking Langy to show a scenario run opens it in place
      Given the project has at least one scenario run
      When I ask Langy to show me one of the scenario runs
      Then the browser lands on that run's detail view
      And the Langy panel is still open with the same conversation
      And the answer still includes the card for the run

    @integration
    Scenario: Surfacing resources without an open intent does not navigate
      When I ask Langy to list recent scenario runs
      Then Langy shows the results as cards
      And the browser stays on the page I was on

    @integration
    Scenario: Langy only navigates to resources reachable with my own access
      Given Langy acts with my own project access when it looks up resources
      When Langy is asked to open a resource it could not look up with that access
      Then the browser does not navigate
      And the answer still renders as cards and text

  Rule: Agent navigation is SPA-safe and never tears the panel down

    @integration
    Scenario: An agent-driven navigation keeps the panel and conversation mounted
      When Langy navigates me to a resource it surfaced
      Then the move uses in-app navigation, not a full page load
      And the panel is not remounted
      And the in-flight response keeps streaming

    @unit
    Scenario: A navigation target outside the app never moves the browser
      When a navigate instruction resolves to an address outside the app
      Then no navigation happens

    @unit
    Scenario: A navigate instruction naming an unknown destination is dropped
      When a navigate instruction names a destination the app cannot resolve to a page
      Then no navigation happens
      And the turn continues unaffected

  # ---------------------------------------------------------------------------
  # The navigate instruction on the live stream
  # ---------------------------------------------------------------------------

  Rule: The agent says which resource; the platform says where that is

    @unit
    Scenario: The navigation address is platform-computed, never agent-authored
      When the agent asks to open a resource it surfaced
      Then the address comes from the platform's own link for that resource
      And any address the agent authors itself is ignored

    @unit
    Scenario: A resource surfaced in an earlier turn can still be opened
      Given Langy looked a resource up in an earlier turn of this conversation
      When the agent asks to open that resource in a later turn
      Then the browser navigates to the platform's link for it

    @unit
    Scenario: Opening a run works even when the lookup's digest names its batch
      Given a lookup surfaced a link that opens one scenario run
      When the agent asks to open that run by its own id
      Then the browser navigates to that link
      And asking to open the batch the lookup named navigates to the same link

  Rule: Navigation is a live-edge instruction, fired at most once

    @integration
    Scenario: A navigate instruction arriving mid-stream does not interrupt the answer
      Given Langy is streaming a response
      When a navigate instruction arrives on the stream
      Then the browser navigates
      And the text keeps streaming to completion

    @integration
    Scenario: Reopening a past conversation does not replay its navigation
      Given a past conversation in which Langy navigated me to a resource
      When I reopen that conversation later
      Then the browser does not navigate
      And the conversation renders with its cards and text

    @unit
    Scenario: A replayed stream tail does not fire the same navigation twice
      Given a turn's live stream is replayed after a reconnect
      When the same navigate instruction is read again
      Then the browser is navigated at most once for that instruction
