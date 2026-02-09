Feature: BullMQ Redis Cluster Compatibility
  As a LangWatch operator
  I want BullMQ queues to work with Redis Cluster
  So that I can deploy LangWatch with high-availability Redis

  Background:
    Given Redis is running in Cluster mode
    And BullMQ queues are configured

  @integration
  Scenario: Standard queue names fail with CROSSSLOT error
    Given a BullMQ queue with name "test-queue" and no hash tag
    When I add a job to the queue
    Then the operation should fail with "CROSSSLOT" error

  @integration
  Scenario: Hash-tagged queue names work with Redis Cluster
    Given a BullMQ queue with name "{test-queue}" (hash-tagged)
    When I add a job to the queue
    Then the operation should succeed
    And the job should be processed by the worker

  @integration
  Scenario: All production queues use hash tags
    Given the following queues are configured:
      | queue_name           | expected_pattern    |
      | collector            | {collector}         |
      | evaluations          | {evaluations}       |
      | topic_clustering     | {topic_clustering}  |
      | track_events         | {track_events}      |
      | usage_stats          | {usage_stats}       |
      | event-sourcing       | {event-sourcing}    |
      | trace_processing     | {trace_processing}  |
      | evaluation_processing| {evaluation_processing} |
    Then all queue names should contain hash tags

  @integration
  Scenario: Workers use matching hash-tagged queue names
    Given a queue with hash-tagged name "{test-queue}"
    And a worker configured for the same queue "{test-queue}"
    When I add and process multiple jobs
    Then all jobs should be processed successfully
    And no CROSSSLOT errors should occur

  @unit
  Scenario: Queue constants define hash-tagged names
    When I inspect the queue constants
    Then COLLECTOR_QUEUE.NAME should equal "{collector}"
    And EVALUATIONS_QUEUE.NAME should equal "{evaluations}"
    And TOPIC_CLUSTERING_QUEUE.NAME should equal "{topic_clustering}"
    And TRACK_EVENTS_QUEUE.NAME should equal "{track_events}"
    And USAGE_STATS_QUEUE.NAME should equal "{usage_stats}"
