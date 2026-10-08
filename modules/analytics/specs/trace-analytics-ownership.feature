Feature: Analytics owns the trace analytics tables
  Analytics is the owner of trace_analytics and trace_analytics_rollup (Q207,
  round 3 ruling): it is their only writer, fed by trace's facts with the same
  fold, and it holds the one has-signal predicate their readers apply. Trace
  keeps the facts and no longer writes or names either table. The move keeps
  every row: nothing is lost or counted twice across the deploy that moves it.

  @integration @unimplemented
  Scenario: A received span lands in trace_analytics once
    Given a project receiving spans for one trace
    When trace records the spans and analytics folds trace's facts
    Then trace_analytics holds one current row for the trace, scoped to its tenant
    And the row matches the fold trace's writer produced before the move

  @integration @unimplemented
  Scenario: The rollup counts each span once
    Given spans for one model and span type within one minute
    When analytics appends their rollup contributions
    Then the rollup bucket's span count and cost equal the sum of those spans
    And redelivering a span's fact does not raise the bucket's totals

  @integration @unimplemented
  Scenario: No span is lost or doubled across the deploy that moves the writers
    Given spans received before the release that moves the writers was deployed
    And spans received after it
    When the worker of the new release has drained every queued delivery
    Then each trace has one current trace_analytics row
    And each span is counted once in trace_analytics_rollup

  @integration @unimplemented
  Scenario: A fact analytics cannot fold is retried, not dropped
    Given trace_analytics refuses an insert
    When analytics handles a span fact for that trace
    Then the delivery fails and is retried
    And the trace's row is written once the insert succeeds

  @unit
  Scenario: Trace's process installs without the trace analytics writers
    Given the trace process module
    When its pipeline is composed
    Then it registers no projection, store or repository for trace_analytics or trace_analytics_rollup

  @unit
  Scenario: Analytics' trace_analytics reader applies the has-signal predicate analytics owns
    Given analytics' slim timeseries read of trace_analytics
    When it filters out rows that carry no persistable signal
    Then it applies the predicate analytics owns
    And the predicate opens every door the fold's signal test opens

  @unit
  Scenario: Trace holds no copy of the has-signal predicate
    Given the trace process module
    When its source is searched for the has-signal predicate
    Then only analytics defines it

  @unit
  Scenario: Analytics hosts the trace analytics fold and rollup as peer lanes on trace's facts
    Given analytics' trace_analytics pipeline
    When it is composed
    Then it declares no event of its own
    And it hosts the slim fold and the per-span rollup as peer lanes

  @unit
  Scenario: Analytics' trace_analytics fold reads through the Redis fold cache under main's keyspace
    Given analytics' trace_analytics pipeline built over the process's Redis
    When the slim fold stores one trace's state
    Then it is cached under main's keyspace, trace_analytics

  @unit
  Scenario: Analytics' trace analytics lanes stamp each row with its project's retention
    Given analytics' trace_analytics pipeline built with the retention peer
    When a lane resolves the retention for a project
    Then it asks the retention peer for that project's resolved retention

  @unit
  Scenario: Analytics' trace analytics fold and rollup price a call the same as every other pricing surface
    Given one model call priced by every server-side surface
    When the analytics fold and the rollup total it
    Then their totals match every other surface's price for the same call

  @unit @unimplemented
  Scenario: A late-arriving span updates the rollup it belongs to
    Given a trace already rolled up
    When a further span for that trace arrives
    Then the rollup includes it
