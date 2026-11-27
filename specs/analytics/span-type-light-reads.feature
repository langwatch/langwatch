Feature: Span type reads use span_analytics instead of the attribute map

  Dashboards, filter pickers, filtered trace lists and the legacy trace search read a span's type
  from stored_spans as SpanAttributes['langwatch.span.type']. Reading one key decompresses the
  whole map, which holds every captured input and output, so a window-scale read of span type
  runs out of memory. span_analytics holds the same value as its plain SpanType column, filled
  by the same rule, and is complete from its floor on.

  Every such read picks its table from the floor and the start of its span window:
  span_analytics alone when the floor covers the window, span_analytics from the floor on plus
  stored_spans before it when the window starts earlier, and stored_spans alone while the floor
  is rebuilding, unknown or unreadable.

  @unit
  Scenario: A floor that covers the window reads span_analytics alone
    Given span_analytics is complete from a floor
    When a span type read starts at or after the floor
    Then it reads span_analytics alone

  @unit
  Scenario: A window that starts before the floor splits at the floor
    Given span_analytics is complete from a floor
    When a span type read starts before the floor or has no start
    Then it reads span_analytics from the floor on and stored_spans before it

  @unit
  Scenario: A whole span_analytics history serves every window
    Given span_analytics holds the whole span history
    When a span type read runs over any window
    Then it reads span_analytics alone

  @unit
  Scenario: A rebuilding, unknown or unparseable floor keeps stored_spans
    Given the span_analytics floor is rebuilding, absent or unparseable
    When a span type read runs
    Then it reads the stored_spans map as before

  @unit
  Scenario: A floor that cannot be read keeps stored_spans instead of failing
    Given reading the span_analytics floor fails
    When a dashboard, picker or trace search reads span types
    Then the read goes on against stored_spans

  @unit
  Scenario: Only reads that name a span type look up the floor
    When a dashboard read has no span type filter, metric or grouping
    Then the floor is not read

  @unit
  Scenario: The dashboard span type filter reads span_analytics where the floor covers it
    When a dashboard is filtered by span type
    Then the filter's trace subquery reads span_analytics' SpanType for the part the floor covers

  @unit
  Scenario: Grouping a dashboard by span type joins span_analytics
    When a dashboard series is grouped by span type
    Then the span join reads span_analytics' SpanType under the name the grouping reads
    And a span join that needs any other span attribute keeps stored_spans

  @unit
  Scenario: The span type picker reads span_analytics where the floor covers it
    When the span type filter's options are listed
    Then they are counted from span_analytics' SpanType for the part the floor covers

  @unit
  Scenario: The trace list span type condition reads span_analytics where the floor covers it
    When traces are listed with a span type filter
    Then the condition checks span_analytics' SpanType for the part the floor covers

  @integration @regression
  Scenario: Span type reads from span_analytics give what stored_spans gives
    Given spans stored in both stored_spans and span_analytics
    When a dashboard filters and groups by span type and the picker lists span types
    Then span_analytics, the split read and stored_spans give the same answers

  @integration @regression
  Scenario: A span type filter over heavy attribute maps stays under a memory cap
    Given spans whose attribute maps carry kilobytes of input and output each
    When traces are filtered by span type under a memory cap
    Then the stored_spans map read exceeds the cap
    And the span_analytics read stays under it
