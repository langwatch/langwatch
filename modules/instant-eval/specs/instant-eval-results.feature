Feature: Every trace-linked Instant Evals result is kept, and recalled before judging

  As a customer asking the same question of the same traces again
  I want a verdict already given on that text, with that judge, to be reused
  So that a repeat ask, a rerun or a dashboard refresh pays only for what is new

  ADR-189, steps 2 to 4. Behind release_instant_eval_results: off, nothing reads or writes
  eval_results and every judgement is made as today.

  The shape:
  - The key is the tenant, the trace, the span (empty for a trace's text), a hash of the
    question, the judge model, a hash of the judged column and its text, and the key version.
  - Only a trace's or a span's text is kept. A thread's or a literal text is judged as today.
  - Recall reuses only judged rows: the latest by JudgedAt, then UpdatedAt, then SourceId.
    A recall adds no row; the misses the judge answered are written in one batch.
  - Each row names its source: ask (the query id), run (the run id), dashboard (the widget
    id) or monitor (the monitor id), and carries the project's trace retention.
  - A monitor's row keys on the trace alone and a hash of its mapped input, output and contexts,
    with judged column "monitor"; a thread-level monitor is not kept. The flag read and each
    eval_results call a monitor makes are bounded by 300 ms. The flag reuses the judge call's one
    organization lookup, so on LangWatch's judge the flag off adds no query, only the cached flag
    read.

  # ============================================================================
  # The key
  # ============================================================================

  @unit
  Scenario: The question hash ignores the column alias and spacing
    Given two calls asking the same question under different column names and spacing
    When their questions are hashed
    Then both hashes are the same
    And a different question or criteria hashes differently

  @unit
  Scenario: The input hash covers the judged column and its text
    Given the same text read by two extractions
    When their inputs are hashed
    Then the hashes differ
    And a changed text hashes differently

  @unit
  Scenario: A thread's or a literal text is not kept
    Given an eval over a conversation, and one over a plain column
    When the cell keys are read
    Then neither has a key

  @unit
  Scenario: A span's text is keyed by its span, a trace's by the trace alone
    Given a row naming a trace and a span
    When a span's text and a trace's text are keyed
    Then the span's key carries the span and the trace's key carries none

  @unit
  Scenario: A row with no trace, or a trace hydration could not find, is not kept
    Given a row that projects no TraceId
    And a row whose trace hydration could not find, so it carries no OccurredAt
    When the cell keys are read
    Then neither has a key

  @unit
  Scenario: A query that projects TraceId but not OccurredAt keeps its trace-level result
    Given a query that projects TraceId and an eval over its trace, but not OccurredAt
    When hydration reads the trace and its eval column is judged
    Then the judged row carries the trace's start time as its OccurredAt, so its result is kept
    And a time the query projected itself is kept as it was
    And the answer holds only the columns the query projected

  @unit
  Scenario: The judge model is the own decision model or LangWatch's judge
    Given a project on LangWatch's judge and one on its own decision model
    When the judge model is read
    Then the first records LangWatch's judge and the second its own model id

  # ============================================================================
  # Recall
  # ============================================================================

  @unit
  Scenario: A repeat question of the same trace text is recalled, not judged
    Given a judged row for a trace, a question, the judge and the text
    When the same question is asked of the same text with the same judge
    Then the stored verdict is answered without a judge call
    And no row is added

  @unit
  Scenario: A text no kept row answers is judged and kept in one batch
    Given no kept row for two traces
    When their question is asked
    Then both are judged
    And both verdicts are written in one insert, stamped with the key version and the retention

  @unit
  Scenario: Recall splits a unit and the budget is checked on what is left
    Given one text asked two questions, one already kept
    When it is judged
    Then the judge is asked only the missed question
    And the budget refuses only what is left to send

  @unit
  Scenario: With release_instant_eval_results off nothing is read or written
    Given a project without the flag
    When a trace's text is judged
    Then eval_results is neither read nor written
    And the judge is asked as today

  @unit
  Scenario: A failed or skipped row never stands in for a verdict
    Given a failed row and a skipped row for the same key
    When the question is asked again
    Then the text is judged again

  @unit
  Scenario: Several kept rows of one key give the latest, deterministically
    Given rows of one key judged at different times, and two judged in the same millisecond
    When the key is recalled
    Then the latest JudgedAt wins, then the latest UpdatedAt, then the greatest SourceId

  @unit
  Scenario: A changed judge model is not recalled
    Given a judged row written by another judge model
    When the question is asked with the project's current judge
    Then the text is judged again

  @unit
  Scenario: A failed recall read judges every text instead
    Given a recall read that fails
    When a trace's text is judged
    Then the judge is asked as if nothing were kept

  @unit
  Scenario: A recall that cannot read its flag or judge model judges as if recall were off
    Given a release_instant_eval_results read that throws, or a judge model read that throws
    When a trace's text is recalled
    Then nothing is recalled and eval_results is not read
    And the ask or run is not failed

  @unit
  Scenario: A batch with recalled verdicts is delivered when the judge loses the rest
    Given one trace's text already kept and another's not
    And a judge that loses every text it is sent
    When the batch is judged
    Then the recalled verdict is delivered and the lost cell is null
    And the lost text is kept as a failed row

  @unit
  Scenario: A result that could not be kept is still delivered
    Given an insert into eval_results that fails
    When a trace's text is judged
    Then the verdict is still answered

  # ============================================================================
  # Each source
  # ============================================================================

  @unit
  Scenario: A quick eval() ask's results name the query
    Given a quick eval() asked from the workbench
    When its verdicts are kept
    Then each row's source is ask and its source id the query's own id

  @unit
  Scenario: A dashboard widget's results name the widget
    Given a dashboard widget that runs an eval()
    When its verdicts are kept
    Then each row's source is dashboard and its source id the widget's id

  @unit
  Scenario: A run keeps every verdict it delivers in its own judgements
    Given a run page of two traces, one already kept
    When the page is judged
    Then only the other trace is sent to the judge
    And the run's own judgements hold both verdicts
    And the kept row of the judged trace names the run

  # ============================================================================
  # The trace's drawer (ADR-189 step 3)
  # ============================================================================

  @unit
  Scenario: A trace's results are the latest per span, question and judged column
    Given kept rows on one trace for two judged columns, a span, and two judge models
    When the trace's results are read
    Then each span, question and judged column answers its latest judged row, newest first
    And each names its question, source, source id, judge model and judged time

  @unit
  Scenario: A failed or skipped result shows only where no judged one exists
    Given a judged row and a newer failed row for one cell, and only a skipped row for another
    When the trace's results are read
    Then the first cell answers its judged row and the second its skipped row

  @unit
  Scenario: A monitor's results are left out of the trace's read
    Given a row a monitor wrote on the trace
    When the trace's results are read
    Then it is not answered, because the trace shows it from evaluation_runs

  @unit
  Scenario: With release_instant_eval_results off a trace's read reads nothing
    Given a project without the flag
    When its trace's results are read
    Then the answer is empty and eval_results is not read

  @integration
  Scenario: A trace's kept results are read from ClickHouse by the trace
    Given judged, failed, skipped, monitor and retired-key rows on one trace in eval_results
    When the trace is read
    Then each cell answers its latest judged row, else its latest failed or skipped one
    And no monitor row and no row of another key version is answered

  # ============================================================================
  # Monitors on the Instant Evals judge (ADR-189 step 4)
  # ============================================================================

  @unit
  Scenario: A monitor's judgment is kept as a monitor row on its trace
    Given a monitor's judge answered a trace
    When its judgment is kept
    Then one judged row is written on the trace alone, judged column monitor
    And its source is monitor and its source id the monitor's id

  @unit
  Scenario: A monitor's kept judgment is recalled by its trace, question, judge and texts
    Given a kept monitor judgment
    When the same trace, question, judge model and mapped texts are asked again
    Then the kept verdict is answered under the question asked now

  @unit
  Scenario: With release_instant_eval_results off a monitor's judgment is neither read nor written
    Given a project without the flag
    When a monitor's judgment is recalled and kept
    Then the recall is empty, and eval_results is neither read nor written

  @unit
  Scenario: A monitor with release_instant_eval_results off makes no eval_results call
    Given a monitor whose judge is on Instant Evals, in a project without the flag
    When the monitor evaluates a trace
    Then instant-eval is asked nothing
    And the monitor reports exactly what it reports today

  @unit
  Scenario: A monitor's repeat judgment of a trace is recalled, not judged
    Given a monitor that already judged a trace
    When it evaluates the same trace again with the same question and judge
    Then the kept verdict is reported in today's shape without a judge call
    And no cost row is written for it

  @unit
  Scenario: A monitor's missed judgment is judged, then kept under the monitor
    Given a monitor that never judged a trace
    When it evaluates the trace
    Then the judge is asked once
    And the answer is kept under the monitor's id

  @unit
  Scenario: A monitor's recall that times out is judged as today
    Given a recall from eval_results that does not answer within its timeout
    When the monitor evaluates a trace
    Then the trace is judged and its verdict reported

  @unit
  Scenario: A monitor's result is delivered when keeping it fails
    Given a write to eval_results that fails
    When the monitor evaluates a trace
    Then the judged verdict and its cost are still reported

  @unit
  Scenario: A monitor's judge call looks up its organization once for every flag it reads
    Given a monitor on LangWatch's judge, whose router reads its own flags
    When it evaluates a trace with release_instant_eval_results on
    Then the router and kept-results flags are read from one organization lookup

  @unit
  Scenario: A monitor whose flag read times out is judged as today
    Given a release_instant_eval_results read that does not answer within the timeout
    When the monitor evaluates a trace
    Then it is judged and reported as today, and instant-eval is asked nothing

  @unit
  Scenario: A thread-level monitor's judge call never reads or writes eval_results
    Given a monitor that judges a thread's conversation
    When its judge call is recalled
    Then it is not kept, and neither the flag nor instant-eval is asked

  @unit
  Scenario: A guardrail's judge call never reads or writes eval_results
    Given a guardrail monitor whose judge is on Instant Evals
    When it evaluates a trace
    Then it is judged as today, and neither the flag nor instant-eval is asked

  @unit
  Scenario: A monitor's judge call with no trace id never reads or writes eval_results
    Given a trace read back with no trace id
    When the monitor evaluates it
    Then it is judged as today, and neither the flag nor instant-eval is asked

  # ============================================================================
  # Storage
  # ============================================================================

  @unit
  Scenario: One insert spans at most one hundred trace weeks
    Given results on traces from more than one hundred different weeks
    When they are written
    Then they are split into inserts of at most one hundred weeks each

  @integration
  Scenario: Kept results are recalled from ClickHouse by their key
    Given judged, failed and other-tenant rows in eval_results
    When a key is recalled
    Then only the tenant's latest judged row of that key is answered
    And judge calls are counted from judged rows only
