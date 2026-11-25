Feature: Unpriced cost recorded when a trace is folded

  A span whose model no price rule covers costs 0, and a trace total of 0 is
  stored as no cost at all. Without more, "free" and "unpriced" look the same,
  and a trace that is partly priced looks complete. So the fold counts the
  spans it could not price and keeps their model names, on trace_summaries and
  trace_analytics, and LangWatchQL exposes both under the cost permission.

  Traces stored before this was recorded are not backfilled: their count is 0
  and their model list is empty, which means "not recorded", not "fully priced".

  @unit
  Scenario: A span whose model has no price is counted as unpriced
    Given a span with token usage for a model the catalogue does not know
    When the span is folded into its trace
    Then the trace counts one unpriced span
    And the trace lists that model as unpriced

  @unit
  Scenario: A priced span is not counted
    Given a span with token usage for a catalogue model
    When the span is folded into its trace
    Then the trace counts no unpriced span

  @unit
  Scenario: A model priced at zero on purpose is not unpriced
    Given a span whose custom rates are all zero
    When the span is folded into its trace
    Then the trace counts no unpriced span

  @unit
  Scenario: A span with no usage is not unpriced
    Given a span that reports no tokens
    When the span is folded into its trace
    Then the trace counts no unpriced span

  @unit
  Scenario: A redundant usage copy is not counted twice
    Given a span marked to skip token accumulation
    When the span is folded into its trace
    Then the trace counts no unpriced span

  @unit
  Scenario: Unpriced models are kept once each, sorted
    Given a trace with unpriced spans for "zeta-model", "alpha-model" and "zeta-model"
    When the spans are folded
    Then the trace counts three unpriced spans
    And the trace lists "alpha-model" and "zeta-model"

  @unit
  Scenario: The analytics row keeps the unpriced count through a read-back
    Given a trace analytics state with two unpriced spans
    When it is written as a row and read back
    Then the state still counts two unpriced spans and lists their model
