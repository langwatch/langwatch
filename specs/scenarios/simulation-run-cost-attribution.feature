Feature: Cost metrics never invent a simulation run
  As a LangWatch customer
  I want the simulations list to hold only runs that really ran
  So that cost is attributed to the run that spent it

  # A span carries `scenario.run_id`. Sixty seconds after its trace goes quiet
  # the trace pipeline computes the trace cost and sends it to the simulation
  # run with that id, as a metrics event.
  #
  # The metrics event is the only simulation event that does not say what the
  # run IS. It carries a run id, a trace id and a cost, and no name, scenario,
  # set or status. Folded onto an aggregate that had never seen a queued,
  # started, snapshot or finished event, it still produced a `simulation_runs`
  # row, because the write takes the run id from the aggregate key. A customer
  # report showed the result: a run in an external set named "default", with no
  # scenario and no end, whose cost and duration rose with every new trace.
  #
  # The trigger was a redaction rule that replaced the run id with a marker,
  # so every trace of every run in a project addressed one aggregate under the
  # same wrong id. That rule is fixed, and the fold does not depend on it being
  # fixed: a run is defined by its lifecycle events, and cost is an attribute
  # of a run, so cost alone writes nothing.
  #
  # Cost is not thrown away. It accumulates in the fold state and reaches the
  # table with the run's first lifecycle event, so a real run whose cost is
  # folded before its start still keeps that cost.

  @unit
  Scenario: Cost metrics for an unknown run write no run row
    Given a simulation aggregate with no queued, started or finished event
    When cost metrics for a trace are folded onto it
    Then no simulation run row is written

  @unit
  Scenario: Cost that arrives before the run starts reaches the row
    Given cost metrics folded onto a simulation aggregate with no run yet
    When the run started event is folded next
    Then the row that is written carries the cost

  @unit
  Scenario: A run with a lifecycle event keeps writing its row
    Given a simulation run that has been queued
    When cost metrics for a trace are folded onto it
    Then the run row is written with the cost
