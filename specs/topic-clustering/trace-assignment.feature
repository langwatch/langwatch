Feature: Topic clustering writes trace assignments via the AssignTopic command queue

  Background:
    Topic clustering's `storeResults` is the gate between the clustering
    output (topics + per-trace assignments) and the systems that read it.
    It must write Postgres `Topic` rows AND emit AssignTopic commands so
    ClickHouse `trace_summaries.TopicId` gets populated; without the
    latter the UI "Top Topics" surface stays empty even when topics
    exist. There is no Elasticsearch dual-write any more, the storage is
    Postgres for topic catalog + ClickHouse for per-trace assignments.

  @unit
  Scenario: Trace assignments flow through the AssignTopic command queue
    Given the clustering run produced topics and per-trace assignments
    When storeResults persists the result
    Then no Elasticsearch call is made
    And one AssignTopic command is emitted per assigned trace
    And the topic name is forwarded so the projection can stamp it on trace_summaries

  # Delivery is at-least-once: a clustering page can be re-run and the command
  # queue can retry, so the same assignment reaches the store more than once.
  # The assignment itself carries the identity, so a repeat is recorded once
  # while a genuine change of topic is still recorded as a new fact.
  @unit
  Scenario: A redelivered trace assignment collapses to one recorded event
    Given a trace was assigned to a topic
    When the same assignment is delivered again
    Then only one assignment event is recorded for that trace and topic
    And the trace's topic is unchanged

  @unit
  Scenario: Re-assigning a trace to a different topic records a new event
    Given a trace was assigned to a topic
    When a later run assigns the trace to a different topic
    Then the later assignment is recorded as its own event
    And the trace reads back with the later topic

  @unit
  Scenario: Re-assigning a trace to a different subtopic records a new event
    Given a trace was assigned to a topic and subtopic
    When a later run keeps the topic but moves the trace to a different subtopic
    Then the later assignment is recorded as its own event
