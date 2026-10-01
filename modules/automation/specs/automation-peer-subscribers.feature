Feature: Automation reacts to trace's and evaluation's existing events from its own side
  Trace and evaluation know nothing of automation. Automation's peer subscribers listen to their
  existing events, carry main's settle windows, and read the folded state through TraceApi and
  EvaluationApi. Delivery is at least once, so each reaction hands the same inputs on
  redelivery and the match identity dedupes it (ARCHITECTURE §9).

  @unit
  Scenario: Automation carries main's settle windows on its own peer lanes
    When automation's pipeline registers its peer subscribers
    Then trace trigger matching settles 30 seconds per trace
    And evaluation trigger matching waits 10 seconds per evaluation with a 30 second dedup
    And graph sweeps debounce 5 seconds per tenant in one lane per tenant

  @unit
  Scenario: A trace's span event wakes trace trigger matching, the same on redelivery
    Given trace recorded a span for a trace that passes the origin guard
    When automation's peer subscriber receives it twice
    Then trace trigger matching records the same match identity both times

  @unit
  Scenario: Automation applies trace's origin guard to the folded summary
    Given a trace with no resolved origin, a stale event, or no summary yet
    When automation's trace trigger matching runs
    Then it records no match

  @unit
  Scenario: An evaluation's settling event wakes evaluation trigger matching, the same on redelivery
    Given evaluation reported a settled run on a trace
    When automation's peer subscriber receives it twice
    Then evaluation trigger matching runs with the same status and trace both times

  @unit
  Scenario: A completed evaluation's trace is read through EvaluationApi
    Given a completed evaluation event, which carries no trace id
    When automation matches it
    Then the run's trace is read through EvaluationApi and the evaluation triggers are matched

  @unit
  Scenario: Project activity wakes the graph-alert sweep, the same on redelivery
    Given trace or evaluation recorded activity for a project
    When automation's peer subscriber receives it twice
    Then the project's graph triggers are swept with the same inputs both times
