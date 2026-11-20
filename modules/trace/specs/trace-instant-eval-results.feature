Feature: The trace drawer shows the Instant Evals results kept on its trace
  Instant-eval owns eval_results (ADR-189). The trace drawer shows every result kept on its
  trace, labelled by who asked: a quick ask, a run or a dashboard widget. Trace never names
  the table: it asks InstantEvalApi through a channel bound to that token, which is not a peer
  edge (dev/docs/ARCHITECTURE.md section 5). A monitor's results still show in the Evals
  section from evaluation_runs, so instant-eval leaves them out of this read. Behind
  release_instant_eval_results.

  @unit
  Scenario: The drawer asks instant-eval for the results of the trace's member
    Given an aggregate whose members both hold kept results on the same trace id
    When the drawer reads the trace's Instant Evals results for the member that holds it
    Then only that member's results are answered
    And where no member holds the trace, the answer is empty

  @integration
  Scenario: The Instant Evals section reads only with release_instant_eval_results on
    Given a project without release_instant_eval_results
    When the drawer opens a trace
    Then the Instant Evals read never runs and the section is not shown

  @integration
  Scenario: The Instant Evals read keys on the trace's window and its member
    Given a project with release_instant_eval_results on
    When the drawer opens a trace of an aggregate's member
    Then the flag is asked for that member
    And the read names the member and the trace's own start and end as its window
    And it waits while the header still belongs to the previous trace

  @unit
  Scenario: Each Instant Evals result names its source, judge model and judged time
    Given results asked from a quick ask, a run and a dashboard widget
    When the drawer lists them
    Then each reads Ask, Run or Dashboard, with the judge model and the time it was judged
    And a result read from a span names that span

  @unit
  Scenario: A verdict reads as its likelihood, score or category, or why there is none
    Given judged boolean, score and category results, and a failed and a skipped one
    When the drawer lists them
    Then a boolean reads as its likelihood, a score as its number and a category as its name
    And a failed result reads as could not judge and a skipped one as skipped

  @unit
  Scenario: A trace the viewer's plan withholds shows no Instant Evals results
    Given a trace the viewer's plan withholds
    When the drawer asks for its Instant Evals results
    Then the read is refused as withheld over plan
    And instant-eval is never asked

  @integration
  Scenario: The Instant Evals section comes straight after Evals
    Given release_instant_eval_results is on and the trace holds kept results
    When the trace summary renders
    Then the Instant Evals section is the one straight after Evals

  @integration
  Scenario: A result read from a span opens that span
    Given a kept result read from one of the trace's spans
    When the drawer lists it
    Then it names that span
    And clicking the span's name opens that span
