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
