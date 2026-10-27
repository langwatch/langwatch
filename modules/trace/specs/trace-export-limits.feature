@trace @export
Feature: Trace export limits
  As a project owner
  I want trace exports bounded by rate and by concurrency
  So that one project cannot spend the whole database on scans

  @unit
  Scenario: A refused export tells the caller how long to wait
    Given a project that has used its exports for the minute
    When it starts another export
    Then the answer is 429 trace_export_rate_limited
    And the answer carries a Retry-After header in whole seconds
