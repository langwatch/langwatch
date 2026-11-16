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

  @unit
  Scenario: Every side-table filter under a share reads only within the share's windows
    Given an evaluation, scenario run or Instant Eval filter compiled for a proof-fenced read
    When the filtered read is built
    Then the side subquery carries the share's windows on that table's own time column
    And an out-of-window side row never decides whether a trace matches

  @unit
  Scenario: A summary read refuses a filter as written that narrows nothing
    Given another module hands the summary read a LangWatchQL filter as written
    When the filter compiles to no condition or one the view cannot answer
    Then the read is refused with filter_parse_error and reads no trace

  @integration
  Scenario: Each filter kind keeps main's rows with another tenant sharing trace ids
    Given two tenants whose traces, spans, evaluations, scenario runs and judgements share ids
    When each filter kind is read through the built conditions and through main's text
    Then both return the same traces for the read's tenant
    And no row of the other tenant admits a trace

  @integration
  Scenario: The trace list keeps main's rows under an own and an aggregate proof
    Given another tenant shares the trace ids of a member's traces
    When the list is read under the member's own proof or an aggregate's tenant set
    Then each filter kind lists the rows main lists, and none of the other tenant's

  @integration
  Scenario: The trace list no longer matches by a side row outside a share's window
    Given a member shares its traces into an aggregate from a time onwards
    And one of the member's traces was evaluated before that time
    When the aggregate's list is filtered by that evaluator
    Then the trace is not listed, though the member's own list still lists it

  @integration
  Scenario: Search suggestions and value pickers keep main's values under each scope
    Given another tenant shares the trace ids of a member's traces and spans
    When the search bar suggests a field's values, or a picker samples a trace, span or event attribute's values
    Then each returns the values main's text returns under an own proof, a tenant set and a windowed share
    And none of the other tenant's values, nor any from before a windowed share

  @integration
  Scenario: Facet counts keep main's answers under each scope
    Given another tenant shares the trace ids of a member's summaries, spans and evaluation runs
    When the sidebar counts its facets on each table, unfiltered or under a summary or a span filter
    Then each count, range and discrete value equals main's under an own proof, a tenant set and a windowed share
    And none counts the other tenant's rows, nor a summary's older version

  @integration
  Scenario: Under a windowed share the facets count the traces the list shows
    Given a member shares its traces into an aggregate from a time onwards
    When the aggregate's list and its facets are read under the same span filter
    Then the facets count exactly the traces the list returns

  @integration
  Scenario: QueryBuilder facets keep main's answers under each scope
    Given another tenant shares the trace ids of a member's summaries, spans and evaluation runs
    When the sidebar reads the evaluator, label, event and attribute-key facets, with and without a value prefix
    And each read is unfiltered or under a summary or a span filter
    Then each answer equals main's under an own proof, a tenant set and a windowed share
    And none counts the other tenant's rows, nor a summary's older version

  @integration
  Scenario: Under a windowed share the queryBuilder facets count the traces the list shows
    Given a member shares its traces into an aggregate from a time onwards
    When the aggregate's list and its trace attribute keys facet are read under the same span filter
    Then the facet counts each key on exactly the traces the list returns
