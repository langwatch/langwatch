Feature: Trace conditions that do not map back run on a windowed schedule

  Scenario: A matching new trace fires once across overlapping windows
    Given a windowed automation "failed-evals" whose condition reads evaluations
    And a trace that matches settles and its evaluation is processed
    When two consecutive sweeps both read it in their overlap
    Then "failed-evals" delivers once for that trace

  Scenario: Traces from before the save never fire
    Given traces that match were recorded before the automation was saved
    When the first sweep runs
    Then nothing is delivered for them

  Scenario: A full page continues on the next wake
    Given 1200 matching traces in one window and a page limit of 500
    When three sweeps run
    Then every matching trace is recorded once and the cursor ends at the window end

  Scenario: The windowed trigger is not matched per trace
    When a matching trace settles
    Then no match is recorded for the windowed automation by the trace subscriber

  Scenario: LWQL going away pauses the sweep without losing traces
    Given LWQL becomes unavailable for one sweep
    When it returns
    Then the next sweep reads from the unmoved cursor and fires the missed traces

  Scenario: A condition that is no longer one expression is refused by the pass
    Given a stored condition "1=1) OR (1=1"
    When the sweep runs
    Then the pass refuses it with trigger_condition_invalid and nothing is delivered
