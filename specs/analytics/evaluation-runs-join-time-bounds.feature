Feature: The evaluation_runs JOIN is bounded below, and only below
  As someone reading a chart that carries an evaluation metric
  I want the JOIN to prune partitions without dropping evaluations
  So that the graph is both cheap and complete

  # The analytics read path joins trace_summaries to evaluation_runs and dedups
  # the join with an IN-tuple subquery. Both scans are bounded below on
  # ScheduledAt, the partition column, and on the table's own UpdatedAt, which
  # is the partition column on deployments predating the unified DDL.
  #
  # Lower-only is the whole design. The window belongs to the TRACE, and an
  # evaluation is inserted at or after the trace it scores but can be scheduled
  # arbitrarily later — an offline experiment or a rerun scores historical
  # traces months on, and a re-evaluation writes a newer row version later
  # still. An upper bound of any width silently empties those graphs.
  #
  # Both halves failed in production before. Filtering on TenantId alone walked
  # the tenant's whole evaluation history on every graph. The attempt to bound
  # it on OccurredAt, which evaluation_runs has not got, then took the read
  # path down: an unqualified name the inner table lacks resolves against the
  # enclosing trace_summaries scope rather than failing, which turned the dedup
  # into a correlated subquery that ClickHouse rejects at query time.

  # ---------------------------------------------------------------------------
  # Executed against ClickHouse: evaluations the window does not contain
  # ---------------------------------------------------------------------------

  @integration
  Scenario: An evaluation scheduled after the queried window still scores its in-window trace
    Given a trace inside the queried window
    And an evaluation of that trace scheduled months after the window ends
    When the analytics layer queries that evaluator's score
    Then the evaluation's score is included

  @integration
  Scenario: Both late-scheduled evaluations are counted, not just the nearest one
    Given two in-window traces evaluated at different times long after the window
    When the analytics layer counts that evaluator's runs
    Then both evaluations are counted

  @integration
  Scenario: A late-scheduled evaluator is still offered as a filter value
    Given an evaluator whose only runs are scheduled after the queried window
    When the filter values for evaluator id are read for that window
    Then the evaluator appears among them

  # ---------------------------------------------------------------------------
  # Executed against ClickHouse: the dedup across weekly partitions
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The dedup keeps the newest version of an evaluation spread across partitions
    Given one evaluation whose row versions sit in different weekly partitions
    And the versions were written out of UpdatedAt order
    When the analytics layer queries that evaluator's score
    Then only the newest version contributes

  # A tie is not resolved by the dedup: both versions equal max(UpdatedAt), so
  # both clear the IN and both reach the graph. Recorded as it behaves rather
  # than as one would want it to, and unchanged by the bounds either way.
  @integration
  Scenario: A tie on UpdatedAt leaves both row versions in the join
    Given two row versions of one evaluation carrying the same UpdatedAt
    When the analytics layer reads that evaluator's runs and score
    Then the count and the average are unaffected and a summed metric doubles

  # ---------------------------------------------------------------------------
  # The guard over the generated SQL
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Bounds qualified with the bounded table's own name are inspected, not skipped
    Given a bound qualified with the name of the table it bounds
    When the generated SQL is checked for bounds on non-prunable columns
    Then that bound is one of the ones inspected

  @unit
  Scenario: A qualified bound on a column the table cannot prune on is still reported
    Given a bound qualified with its table's name, naming a column that cannot prune
    When the generated SQL is checked for bounds on non-prunable columns
    Then the bound is reported

  @unit
  Scenario: A bound qualified with the outer query's alias stays out of the inner table's bounds
    Given a bound qualified with the outer query's alias
    When the bounds of the inner table are collected
    Then the outer query's bound is not among them
