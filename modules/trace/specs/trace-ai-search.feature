Feature: AI search turns plain words into a trace query
  The explorer's Ask AI and Enter-on-a-sentence send the words to the
  project's `traces.ai_search` model and run the query it answers.
  Ported from main's tracesV2 aiQuery, aiAction and routeSearch.

  @unit
  Scenario: Ask AI answers a query the explorer applies
    Given a project whose AI search model answers "status:error" for "traces with errors"
    When a viewer asks AI for "traces with errors"
    Then the answer is a query to apply, "status:error"
    And the model was asked on the project's `traces.ai_search` feature

  @unit
  Scenario: The AI search procedures hand the viewer's proof to the trace module
    Given a viewer with `traces:view` on the project
    When they ask AI, compose a query or press Enter on a sentence
    Then the trace module answers each with the viewer's proof and time window
    And the procedure returns its answer unchanged

  @unit
  Scenario: A process composed without a model refuses AI search by name
    Given a trace module composed with no model seam
    When a viewer asks AI for "traces with errors"
    Then the call is refused with `service_unavailable`

  @unit
  Scenario: The composed trace module carries the model seam
    Given the trace module composed from its peers
    Then AI search reaches the model provider peer
