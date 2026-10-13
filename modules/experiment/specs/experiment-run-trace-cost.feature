Feature: A run's unpriced rows take their trace's cost

  A target row reported without a cost may still have produced a trace that
  trace priced when it settled. Reading a run fills such a row from that
  trace's cost through trace's own read; experiment never queries trace's
  tables. Main split a trace's cost evenly across the rows sharing it.

  @unit
  Scenario: A target row that recorded no cost takes its trace's cost
    Given a run whose target row recorded no cost and names a trace that cost 0.3
    When the run is read
    Then the row's cost is 0.3

  @unit
  Scenario: Rows sharing one trace split its cost evenly
    Given a run whose three target rows name the same trace that cost 0.3
    When the run is read
    Then each unpriced row's cost is 0.1

  @unit
  Scenario: A row that recorded its own cost keeps it
    Given a run whose target row recorded a cost of 0.5 and names a trace that cost 0.3
    When the run is read
    Then the row's cost is still 0.5 and trace is not asked

  @unit
  Scenario: A trace without a positive cost leaves the row unpriced
    Given a run whose target row recorded no cost and names a trace that cost nothing
    When the run is read
    Then the row's cost is still empty

  @unit
  Scenario: A failed trace read leaves the rows unpriced
    Given a run whose target row recorded no cost and trace's cost read fails
    When the run is read
    Then the run is returned with the row's cost still empty

  @unit
  Scenario: Trace's cost read asks only within a day of the run's first and last write
    Given a run created at one time and last updated later
    When the run is read
    Then trace is asked for costs from a day before its creation to a day after its last update

  @integration
  Scenario: Trace answers the latest summary cost of the named traces inside the window
    Given trace holds two summaries of one trace and a summary of a trace outside the window
    When experiment asks trace for the costs of both traces inside the window
    Then trace answers the latest cost of the first trace only
