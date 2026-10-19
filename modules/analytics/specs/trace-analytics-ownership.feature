Feature: Analytics reads the trace analytics tables trace shares with it
  Trace owns trace_analytics and trace_analytics_rollup and writes them on its
  own pipeline, folded from its facts (EF-5, 2026-10-07, overriding Q207). It
  declares both shared for reading with analytics in the clickhouse-table-ownership
  policy; analytics reads them, holds the one has-signal predicate their readers
  apply, and never writes them. Trace's writer is specified in
  modules/trace/specs/trace-projections.feature.

  @unit
  Scenario: Analytics' trace_analytics reader applies the has-signal predicate analytics owns
    Given analytics' slim timeseries read of trace_analytics
    When it filters out rows that carry no persistable signal
    Then it applies the predicate analytics owns
    And the predicate opens every door the fold's signal test opens

  @unit @unimplemented
  Scenario: Trace holds no copy of the has-signal predicate
    Given the trace process module
    When its source is searched for the has-signal predicate
    Then only analytics defines it
