Feature: Bounded fold state keeps one aggregate from monopolizing the pipeline

  A fold projection accumulates state by reading the previous state,
  applying an event, and writing it back. If that state can grow without
  limit as more events arrive for one aggregate, a single very large
  aggregate (for example a long agent conversation with hundreds of spans,
  each carrying tracked-event payloads) can grow a multi-megabyte state.
  A state that large no longer fits the write-through cache, so every fold
  step falls back to a full read from the persistent store. That turns
  folding back into quadratic work and lets one aggregate saturate the
  shared single-threaded queue, starving every other tenant.

  The fold state must stay bounded regardless of how many events or how
  much payload one aggregate produces, so it always fits the cache and no
  single aggregate can monopolize the pipeline.

  Background:
    Given a trace summary fold projection
    And the projection hoists tracked span events onto the trace summary

  Scenario: The accumulated events list is capped by a total size budget
    Given a trace whose spans carry tracked events far exceeding the size budget
    When all the spans are folded into the trace summary
    Then the accumulated events list stays within the size budget
    And the earliest events are preserved
    And the summary records that later events were dropped

  Scenario: A small event stream is kept in full
    Given a trace whose tracked events stay well within the size budget
    When all the spans are folded into the trace summary
    Then every tracked event is present in the trace summary
    And the summary does not record any dropped events

  Scenario: Computed input and output are capped to a maximum length
    Given a trace whose computed input and output exceed the maximum length
    When the trace summary is folded
    Then the stored computed input and output are truncated to the maximum length
    And the truncation is marked so consumers know the value is partial

  Scenario: A bounded state stays cacheable across fold steps
    Given a trace with hundreds of spans folded one event at a time
    When each fold step reads the previous state
    Then the state stays small enough to remain in the write-through cache
    And fold steps after the first read from the cache, not the persistent store

  Scenario: An oversized state is surfaced instead of silently re-reading
    Given a fold state that still exceeds the cacheable size budget
    When the state is written through the cache
    Then the oversized state is recorded on a metric
    And operators can see which projection produced it
