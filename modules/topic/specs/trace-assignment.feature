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

  # Incremental runs used to re-read every unassigned trace in the hot tier each day, and their
  # assignments to traces older than the summary read window never landed, so the same traces
  # were embedded again on every run.

  @integration
  Scenario: A topic assignment lands on a trace older than the summary read window
    Given a trace that occurred 40 days ago
    When clustering assigns it a topic and subtopic
    Then the assignment is stamped with the trace's own time
    And trace_summaries carries the topic, so the next incremental run does not read the trace
    And an assignment stamped with the current time would not reach the trace
    And a trace whose time is unknown is stamped with the current time

  @unit
  Scenario: A trace the service lists twice is assigned once
    Given the clustering service lists a trace under its topic and again under a new subtopic
    When storeResults persists the result
    Then one AssignTopic command is sent for that trace, carrying the subtopic

  @unit @integration
  Scenario: A finished run moves the clustering watermark so the next run skips what it read
    Given a project in incremental mode whose last finished run read traces up to a watermark
    When the daily wake or a manual request starts a run
    Then the run reads only traces that occurred after the watermark and at least an hour before the run started
    And every continuation page of that run reads the same window
    And when the run's last page lands the watermark moves to the end of the run's window
    And a project with no finished run yet reads the whole hot tier once

  @unit
  Scenario: A run that clustered nothing leaves the watermark where it was
    Given a project with a clustering watermark
    When its run fails, or its walk ends because no clustering model is configured or batch clustering ran recently
    Then the watermark does not move and the next run reads the same traces again
    And a run recorded before runs carried a window does not move the watermark

  @unit
  Scenario: A batch run still reads every trace in the hot tier
    Given a project that has fewer than 1200 assigned traces
    When a run starts with a watermark
    Then the page reads the hot tier without the watermark
