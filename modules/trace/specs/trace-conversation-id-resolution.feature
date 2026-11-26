Feature: A trace's conversation id reads the same everywhere
  As a LangWatch user looking at a trace that belongs to a conversation
  I want the Conversation pill, the conversation filter and the conversation facet to agree
  So that clicking the pill's filter lists the traces of that conversation

  Ingest folds thread ids onto `gen_ai.conversation.id`. Trace summaries written
  before that fold keep the id under `langgraph.thread_id` or `langwatch.thread_id`
  only. The drawer header, the list row, the facet, `conversation:"<id>"` and
  `has:conversation` all resolve the same key chain, in this order:
  `gen_ai.conversation.id`, `langgraph.thread_id`, `langwatch.thread_id`. An
  empty value under an earlier key falls through to the next one.

  @unit
  Scenario: The conversation id follows the key chain
    Given trace attributes carrying a conversation id under one or more of the supported keys
    When the conversation id is resolved
    Then the first non-empty value along the chain is returned
    And attributes carrying none of the keys resolve to an empty conversation id

  @unit
  Scenario: The pill and the conversation facet show the same id
    Given trace summaries carrying the conversation id under any supported key layout
    Then the drawer header's conversation id equals the conversation facet's in-memory value
    And the facet's ClickHouse expression reads every supported key

  @unit
  Scenario: The pill's filter matches a trace keyed under langgraph.thread_id
    Given a trace summary whose conversation id is set under "langgraph.thread_id" only
    When the query `conversation:"<that id>"` is evaluated in memory
    Then the trace matches
    And a trace with another conversation id or none does not

  @unit
  Scenario: has:conversation counts a legacy-key trace as having a conversation
    Given a trace summary whose conversation id is set under "langgraph.thread_id" only
    When "has:conversation" and "none:conversation" are evaluated
    Then the trace has a conversation and is not listed under none:conversation
    And the compiled SQL predicate reads the same key chain

  @integration
  Scenario: Filtering by a legacy-key conversation id returns the trace from ClickHouse
    Given a stored trace summary whose conversation id is stored under "langgraph.thread_id" only
    When the trace list is filtered by `conversation:"<that id>"` or `has:conversation`
    Then the trace appears in the results with that conversation id
    And the conversation facet counts it under that id
