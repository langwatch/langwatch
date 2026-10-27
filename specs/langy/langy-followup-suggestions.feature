Feature: Langy suggests the next step after a result
  As a LangWatch user chatting with Langy
  I want a card's result to offer the obvious next moves on it
  So that an answer becomes a saved view, a graph, a dataset or an alert without me rebuilding the query by hand

  # Extends langy-capability-cards.feature. A capability card answers "what did
  # you find"; a suggestion answers "what do I do with it". The two are layered:
  # cards render results, suggestions turn a result into the next artifact.
  #
  # The pivot is the tool call's INPUT, not its output. When Langy searches
  # traces it passes a structured intent — filter fields, free text, a date
  # range. That intent is the query, already written. A suggestion carries it to
  # another surface rather than making the user reconstruct it there. This is
  # what "show them on the traces view" means concretely: not a link to the
  # traces index, but a link to the traces index ALREADY FILTERED to what Langy
  # just found.
  #
  # Suggestions are offers, never actions taken on the user's behalf: showing a
  # suggestion must not create, mutate or persist anything. That only happens
  # when the user picks one. This keeps the propose-then-apply rule of the card
  # catalogue intact.

  Background:
    Given I am signed in to LangWatch on a project
    And I have opened the Langy panel

  Rule: A trace search offers the next steps on the traces it found

    @integration
    Scenario: The traces card puts the offer that carries the search first
      When Langy searches traces for the words "checkout failed" and finds some
      Then the traces card offers at most three next steps
      And the alert offer, which carries the search, comes before the offers that only open a surface

    @integration
    Scenario: A search that filtered on errors carries the error filter across
      When Langy searches for traces that contain an error in the last day
      And I choose to show them in the traces view
      Then the traces view opens showing only errored traces
      And the time range is the last day

    # The graph builder filters on fields only — a free-text search has nowhere
    # to go there, so the offer must not pretend to bring it along.
    @integration
    Scenario: The graphing offer never claims to carry what the graph cannot hold
      When Langy searches traces for the words "checkout failed"
      Then the traces card still offers the Analytics surface
      But the offer reads as opening the surface, not as graphing that search

    @integration
    Scenario: The traces card suggests alerting on the search
      When Langy searches traces for the words "checkout failed"
      Then the traces card offers to set up an alert for that search
      And choosing it opens the automation flow with that search already set as the alert's subject
      And nothing is created until I act there

    @integration
    Scenario: A search with nothing to carry offers no alert
      When Langy searches traces with neither a filter nor a search term
      Then the traces card offers no alert, since there is no search to alert on
      And it offers the Analytics, Annotations and Datasets surfaces as plain chips

  Rule: A suggestion only appears when it can actually be carried out

    @unit
    Scenario: A search with no filters and no text suggests nothing to carry
      When Langy searches traces with neither a filter nor a search term
      Then no offer claims to carry the search
      And every offer only opens its surface

    @integration
    Scenario: A search that matched nothing offers no dataset suggestion
      When Langy searches for traces and finds none
      Then the traces card does not offer to add traces to a dataset

    @unit
    Scenario: Carried text is never mistranslated into a filter
      When Langy searches traces for text that happens to look like a field filter
      Then the destination receives it as the same free text Langy searched for
      And it never becomes a filter the user did not ask for

  Rule: A single trace offers the next steps on that one trace

    @integration
    Scenario: A trace lookup offers the surfaces that act on traces
      When Langy looks up a single trace
      Then the trace card offers the Analytics, Annotations and Datasets surfaces as plain chips
      And it offers no alert, since a lookup carries no search

  Rule: Suggestions read as offers, not as things already done

    @integration
    Scenario: Suggestions are visually secondary to the result
      When Langy renders a card with suggestions
      Then the suggestions read as a row of quiet chips beneath the result
      And they do not compete with the card's own "Open in <surface>" link

    @integration
    Scenario: A card with nothing worth suggesting shows no suggestion row
      When Langy renders a card that has no next step worth offering
      Then no empty suggestion row is rendered

    @unit
    Scenario: A prompts result earns no bare surface chips
      When Langy lists prompts and the card renders
      Then no chip offers Experiments or Scenarios
      And the prompts card keeps only its own deep link into Prompts

    @unit
    Scenario: A created scenario earns no bare simulations chip
      When Langy creates a scenario and the card renders
      Then no chip offers Simulations or Run plans
      And the run is offered on the card itself, in words
