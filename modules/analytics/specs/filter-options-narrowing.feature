Feature: Filter options narrowed by the other filters

  A filter picker offers the values of one field, narrowed by every other filter
  already applied, through analytics' own filter grammar (ADR-202 Decided 26). It
  reads under the route's proof, so on an aggregate a side-table check holds each
  member inside its share's window (ADR-202 Decided 27).

  @unit
  Scenario: A filter picker is narrowed by the other filters, never its own
    Given a filter picker asked for one field with other filters selected
    When analytics looks up the picker's options
    Then the read is narrowed by the other filters through analytics' own grammar
    And the field's own selection does not narrow it

  @integration
  Scenario: An aggregate's picker holds a side-table filter inside the member's share window
    Given an aggregate member shared until noon, with a trace before noon evaluated after it
    When a picker is narrowed by that trace's evaluator
    Then the trace is not offered, because its evaluation ran outside the share's window
