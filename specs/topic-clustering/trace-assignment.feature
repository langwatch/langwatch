Feature: Topic clustering writes trace assignments under both storage backends

  Background:
    Topic clustering's `storeResults` is the gate between the clustering
    output (topics + per-trace assignments) and the systems that read it.
    It must write Postgres `Topic` rows AND emit AssignTopic commands so
    ClickHouse `trace_summaries.TopicId` gets populated; without the
    latter the UI "Top Topics" surface stays empty even when topics
    exist.

    Self-hosted installs may still write to Elasticsearch for back-compat
    (trace docs carry `metadata.topic_id`); SaaS prod is ClickHouse-only
    and uses a throwing proxy for any ES call. The function must NOT
    skip the AssignTopic emission just because ES isn't configured.

  @unit
  Scenario: Trace assignments survive when Elasticsearch is not configured
    Given Elasticsearch is not configured for the project
    And the clustering run produced topics and per-trace assignments
    When storeResults persists the result
    Then the ES bulk index call is skipped
    And one AssignTopic command is emitted per assigned trace
    And the topic name is forwarded so the projection can stamp it on trace_summaries

  @unit
  Scenario: Trace assignments dual-write to Elasticsearch when configured
    Given Elasticsearch IS configured for the project
    And the clustering run produced topics and per-trace assignments
    When storeResults persists the result
    Then the ES bulk index call runs with the configured trace index
    And one AssignTopic command is emitted per assigned trace
