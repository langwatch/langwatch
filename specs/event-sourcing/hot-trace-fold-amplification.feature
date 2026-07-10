Feature: Hot-trace fold amplification is bounded

  Order-insensitive trace folds (traceSummary and its slim mirror
  traceAnalytics) accumulate distributed spans that, by nature, arrive in any
  order. The fold executor detects an "out-of-order" event when its occurredAt
  precedes the aggregate's persisted checkpoint. For an order-insensitive fold
  the late event must simply be applied on top — never trigger a full re-fold
  of the aggregate's event history.

  Re-folding on every out-of-order batch is the 2026-07-09 storm: replaying the
  whole history reads every event for the aggregate and raises the checkpoint
  to the aggregate's maximum event time, so every later batch also looks out of
  order. A hot trace (a Claude Code session streams 100k+ events into one
  aggregate) then re-folds forever and never catches up. On 2026-07-10 a single
  trace held 112k staged fold jobs draining at ~0 for this reason.

  These folds therefore set options.refoldOnOutOfOrder = false. A genuine store
  miss still rebuilds full state (options.refoldOnStoreMiss), and events are
  never dropped — the executor applies them in occurredAt order on top of the
  state it loaded.

  Background:
    Given a trace fold with a persisted checkpoint at a known occurred-at
    And the fold's event loader is available for re-folds

  @unit
  Scenario: The trace summary folds an earlier span without reading the event log
    Given a trace summary state with spans already folded past the processing cap
    When a span that occurred before the checkpoint is folded
    Then the event log is not re-read
    And the span is still counted

  @unit
  Scenario: Folding out-of-order spans without a re-fold still counts every span
    Given a trace summary state with spans already folded
    When a batch of three spans that all occurred before the checkpoint is folded
    Then the event log is not re-read
    And every span in the batch is counted
    And the checkpoint is not rewound below its high-water mark

  @unit
  Scenario: The slim trace-analytics fold folds an earlier span without reading the event log
    Given a trace-analytics (slim) state with spans already folded past the processing cap
    When a span that occurred before the checkpoint is folded
    Then the event log is not re-read
    And the span is still counted

  @unit
  Scenario: Evaluation folds keep re-folding because order is significant
    Given an evaluation fold whose result depends on event order
    When an event arrives out of order
    Then the aggregate is re-folded from the event log in occurred-at order
