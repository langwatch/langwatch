Feature: Trace filters compile to built conditions
  The trace filter compiler returns builder conditions, not SQL text, so every
  filtered read is built and each side-table subquery reads under the filtered
  read's own scope (ADR-202, Decided 18).

  @unit
  Scenario: Every filter kind compiles to conditions with the text compiler's parameters
    Given a trace filter of any field, attribute, free text or evaluator group
    When it is compiled to conditions
    Then the parameters it binds are those the text compiler binds, by name and value
    And it refuses an unknown field, a bad value and too many conditions as the text compiler does

  @unit
  Scenario: A side-table filter reads its table under the filtered read's own scope
    Given a filter on spans, evaluations, scenario runs or Instant Eval judgements
    When the filtered read is built
    Then the side table is read in a set subquery of tenant and key under the read's scope
    And a negated filter excludes with NOT over that subquery

  @unit
  Scenario: A span filter under a proof reads the proof's shared windows
    Given a span filter compiled for a proof-fenced read
    When the filtered read is built
    Then the span subquery carries the proof's windows as the read does

  @integration
  Scenario: Each filter kind keeps main's rows with another tenant sharing trace ids
    Given two tenants whose traces, spans, evaluations, scenario runs and judgements share ids
    When each filter kind is read through the built conditions and through main's text
    Then both return the same traces for the read's tenant
    And no row of the other tenant admits a trace
