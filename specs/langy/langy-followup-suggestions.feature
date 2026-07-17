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
    Scenario: The traces card suggests carrying the search into the traces view
      When Langy searches for traces and finds some
      Then the traces card offers to show those traces in the traces view
      And choosing it opens the traces view already filtered to that same search
      And I do not have to retype the query

    @integration
    Scenario: A search that filtered on errors carries the error filter across
      When Langy searches for traces that contain an error in the last day
      And I choose to show them in the traces view
      Then the traces view opens showing only errored traces
      And the time range is the last day

    @integration
    Scenario: A free-text search carries the text across
      When Langy searches traces for the words "refund policy"
      And I choose to show them in the traces view
      Then the traces view opens searching for that same text

    @integration
    Scenario: The traces card suggests saving the search as a lens
      When Langy searches for traces and finds some
      Then the traces card offers to save that search as a lens
      When I choose it and name the lens
      Then a lens with that name is saved for the project
      And the lens is locked to the search Langy ran
      And nothing is saved until I choose the suggestion

    @integration
    Scenario: The traces card suggests graphing the search
      When Langy searches for traces and finds some
      Then the traces card offers to graph those traces
      And choosing it opens the graph builder with that search already applied as the graph's filters

    @integration
    Scenario: The traces card suggests adding the traces to a dataset
      When Langy searches for traces and finds some
      Then the traces card offers to add those traces to a dataset
      And choosing it opens the add-to-dataset flow preloaded with the traces Langy listed

    @integration
    Scenario: The traces card suggests alerting on the search
      When Langy searches for traces and finds some
      Then the traces card offers to set up an alert for that search
      And choosing it opens the automation flow with that search already applied as the alert's filters

  Rule: A suggestion only appears when it can actually be carried out

    @unit
    Scenario: A search with no filters and no text suggests nothing to carry
      When Langy searches traces with neither a filter nor a search term
      Then the traces card does not offer to save an empty search as a lens
      And it does not offer to graph an empty search

    @integration
    Scenario: A search that matched nothing offers no dataset suggestion
      When Langy searches for traces and finds none
      Then the traces card does not offer to add traces to a dataset

    @unit
    Scenario: A filter Langy used that the traces view cannot express is dropped, not mistranslated
      When Langy searches traces using a filter the traces view has no equivalent for
      Then the suggestion carries across only the filters the traces view can express
      And it never invents a filter the user did not ask for

  Rule: A single trace offers the next steps on that one trace

    @integration
    Scenario: A trace lookup suggests adding that trace to a dataset
      When Langy looks up a single trace
      Then the trace card offers to add that trace to a dataset

    @integration
    Scenario: A trace lookup suggests finding traces like it
      When Langy looks up a single trace
      Then the trace card offers to find similar traces
      And choosing it opens the traces view filtered to traces sharing that trace's conversation

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
