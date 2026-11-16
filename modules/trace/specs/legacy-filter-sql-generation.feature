Feature: ClickHouse filter-SQL generation
  As a platform operator
  I want each analytics filter field to compile to a fixed, parameterized SQL shape
  So that saved views and dashboards read the traces the filter actually describes

  `legacyTraceFilterTerms` turns a whole filter set into builder conditions
  over `trace_summaries`, one per field, ANDed into the read they narrow.
  Every value a caller supplies is a bound parameter, never concatenated
  into the SQL: a filter field is a request-controlled input, and a condition
  that inlines a value instead of binding it turns a saved view into an
  injection point.

  Background:
    Given a set of selected values for one filter field

  Rule: Simple attribute filters compile to a parameterized IN clause

    @unit
    Scenario: A single-valued attribute filter becomes <column> IN (...)
      Given a filter field backed by one trace_summaries column
      When the condition builder runs
      Then the SQL is a parameterized IN clause against that column

  Rule: Set-membership filters compile to a hasAny(...) check

    @unit
    Scenario: A list-valued attribute filter becomes hasAny(...)
      Given a filter field backed by a JSON or array-typed attribute
      When the condition builder runs
      Then the SQL checks set membership via hasAny, never a literal value

  Rule: Metadata key/value filters check all three legacy key formats

    @unit
    Scenario: A metadata key filter checks the canonical, legacy, and bare attribute names
      Given one or more metadata keys, possibly dot-encoded
      When the condition builder runs
      Then the SQL checks all three historical key formats, decoded back to dots,
        OR'd together when there is more than one

    @unit
    Scenario: A metadata value filter requires its key
      Given a metadata value filter with no key
      When the condition builder runs
      Then the condition matches nothing, not a query against an unresolvable column

  Rule: Tri-state boolean filters collapse true/false selection into a fixed predicate

    @unit
    Scenario: Selecting only true, only false, both, or neither yields the matching predicate
      Given a boolean-backed filter field with true and/or false selected
      When the condition builder runs
      Then true-only, false-only, both, and neither each yield their own fixed SQL shape

  Rule: Evaluation filters match a trace by its tenant and id in evaluation_runs

    @unit
    Scenario: An evaluator-scoped filter matches a trace by its tenant and id in evaluation_runs
      Given a filter field that correlates against evaluation_runs
      When the condition builder runs
      Then the trace's (TenantId, TraceId) is in a subquery of evaluation_runs
        read under the filtered read's own scope

    @unit
    Scenario: A numeric evaluation range filter rejects invalid or inverted ranges
      Given an evaluation score or event-metric range filter
      When the values are non-numeric, fewer than two, or min is greater than max
      Then the condition matches nothing instead of a malformed range

  Rule: Span- and event-probing filters bound their subquery to the dashboard window

    @unit
    Scenario: A span- or event-probing filter carries a partition-key range when a time window is given
      Given a filter set containing a field that probes stored_spans
      And a dashboard time window
      When the conditions are generated
      Then the stored_spans subquery is bounded by the buffered window, clamped at zero

    @unit
    Scenario: A span- or event-probing filter stays unbounded without a time window
      Given a filter set containing a field that probes stored_spans
      And no dashboard time window
      When the conditions are generated
      Then the stored_spans subquery carries no StartTime predicate

  Rule: Every bound value is a query parameter, never inlined into the SQL string

    @unit
    Scenario: A value containing SQL metacharacters never appears in the generated SQL text
      Given a filter value containing characters that would matter to a SQL parser
      When the condition builder runs
      Then the value appears only in the parameter map, and the SQL text is unchanged
        by what the value contains

  Rule: Composing a filter set flags unsupported fields without discarding supported ones

    @unit
    Scenario: An empty filter set produces no conditions
      Given no filters are selected
      When the conditions are generated
      Then no conditions and no parameters are produced

    @unit
    Scenario: A field with no condition builder is flagged unsupported and contributes no condition
      Given a filter field with no registered condition builder
      When the conditions are generated
      Then hasUnsupportedFilters is true and that field emits no condition

    @unit
    Scenario: An unsupported field does not suppress a supported field alongside it
      Given one supported and one unsupported filter field selected together
      When the conditions are generated
      Then the supported field's condition is still emitted and hasUnsupportedFilters is true

    @unit
    Scenario: Nested key-scoped filters are combined with OR
      Given a filter field with multiple keys, each with its own values
      When the conditions are generated
      Then a single key's condition is emitted alone, and multiple keys' conditions are combined with OR

    @unit
    Scenario: Each filter field binds its own parameters
      Given more than one filter field is selected
      When the conditions are generated
      Then each field's values are bound under distinct parameters, the fields ANDed
