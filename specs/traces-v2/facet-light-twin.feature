Feature: Span facets read the span table without attribute maps

  The trace explorer's span facets (span type, span name, span status) were counted over
  stored_spans, where span type is a key inside SpanAttributes. Reading one key decompresses the
  whole map, which holds every captured input and output, so the facet pass ran past its memory
  cap and pushed the server past its overall limit, failing span inserts with it. span_analytics
  holds the same facts as plain columns from its floor on.

  @unit
  Scenario: A span facet pass inside the span_analytics floor reads span_analytics
    Given span_analytics holds every span from the floor on
    When the span facets are counted for a window that starts at or after the floor
    Then the pass reads span_analytics on StartTime with its SpanType column

  @unit
  Scenario: One span facet's values inside the floor read span_analytics
    Given span_analytics holds every span from the floor on
    When the values of the span type facet are listed for a window that starts at or after the floor
    Then the read uses span_analytics with its SpanType column
    And when the floor cannot be read, it uses stored_spans with the map expression

  @unit
  Scenario: A window that starts before the floor reads stored_spans
    When the span facets are counted for a window that starts before the floor
    Then the pass reads stored_spans as before

  @unit
  Scenario: While span_analytics is rebuilding the span facets read stored_spans
    Given the span_analytics replay has not recorded where it starts
    When the span facets are counted
    Then the pass reads stored_spans

  @unit
  Scenario: A batch with a facet that has no light column reads its own table
    When a batch holds a facet without a light expression
    Then the pass reads the facet's own table

  @integration @regression
  Scenario: Span facets from span_analytics count what stored_spans counts
    Given spans stored in both stored_spans and span_analytics
    When the span facets are counted from each table
    Then both give the same values and counts
