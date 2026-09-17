Feature: Evaluation trace digests
  Evaluations read the same span digest through Trace as the scenario judge.

  @unit
  Scenario: Evaluation digests retain captured span content and timing
    Given a captured span with input, output and millisecond timestamps
    When an evaluation asks Trace to format its spans
    Then the digest includes the span name, input, output and duration
    And the captured span remains unchanged

  @unit
  Scenario: An empty evaluation trace has the canonical empty digest
    Given a trace with no spans
    When an evaluation asks Trace to format its spans
    Then the digest states that no spans were recorded
