Feature: Langy's simulation-run card shows the live run, not a text snapshot
  As a LangWatch user asking Langy about a simulation run
  I want the run card in the chat to show the run's real, current state
  So that a running simulation visibly progresses and a renamed scenario shows
  its current name — without the agent re-fetching anything

  # Today the card is a text snapshot: the agent's CLI tool output is regexed
  # for a name, a status word and two preview lines. That freezes whatever the
  # tool printed at the moment it ran — a run that was "IN_PROGRESS" when
  # surfaced stays "IN_PROGRESS" in the chat forever.
  #
  # The platform's principle is ids-on-the-wire: tool envelopes carry ids, the
  # UI owns freshness. This spec applies it to the chat's run card and to run
  # ids in the agent's prose:
  #
  #   - the card keeps only the run id from the tool envelope and fetches the
  #     run's state through the same query + polling policy the simulations
  #     drawer uses, rendering the app's own simulation card (status pill +
  #     conversation preview) instead of scraped lines;
  #   - the agent references resources in prose as markdown links built from
  #     the command output's own name + platformUrl pair (never an authored or
  #     retyped URL, never an opaque id) — the chat renders them as named
  #     links that move in-app, and marks links that leave the instance.
  #
  # See specs/langy/langy-capability-cards.feature (card taxonomy),
  # specs/langy/langy-agent-driven-navigation.feature (the drawer address).

  Background:
    Given I am signed in to LangWatch on a project
    And I have opened the Langy panel

  Rule: The run card renders the platform's live state for the run it names

    @integration
    Scenario: The card shows the run's live status and conversation
      Given a tool result that references a simulation run by id
      When the chat renders the run's card
      Then the card shows the status the platform reports for that run
      And the card shows the run's conversation preview from the platform
      And nothing on the card comes from parsing the tool's printed text

    @integration
    Scenario: A running simulation's card keeps itself fresh
      Given the run the card shows is still in progress
      When the platform reports new state for the run
      Then the card reflects the new state without a new agent turn
      And the card stops asking for updates once the run reaches a final state

    @integration
    Scenario: Clicking the card opens the run's own detail drawer
      When I click the run card
      Then the run's detail drawer opens
      And it is the same drawer the simulations page opens for that run

    @integration
    Scenario: A card without a run id keeps the snapshot rendering
      Given a tool result that references a scenario template, not a run
      When the chat renders its card
      Then the card renders from the tool's printed text as before
      And no live run lookup is attempted

  Rule: A resource in the agent's prose reads as a named link, never a raw address

    @integration
    Scenario: A platform link in the reply opens in place
      Given the agent's reply references a resource as a markdown link carrying the platform's own address
      When I activate the link
      Then the browser moves there without a full page load
      And the Langy panel stays mounted with its conversation

    @unit
    Scenario: A link that leaves this LangWatch instance is marked external
      When the agent's reply carries a link to an address outside this LangWatch instance
      Then the link is visibly marked as leaving the app
      And it opens outside the conversation, never navigating the app away
