Feature: The judgments dataset, an Instant Eval run's answers as ordinary SQL

  As an AI engineer or an agent
  I want the judgements a run wrote to be a queryable dataset
  So that the follow-up question is a join rather than a second product surface

  Issue: Instant Evals, PR 4. ADR-137.

  The shape:
  - `analytics.judgments` is one row per run, trace and question, with the verdict split
    into the columns each question kind fills.
  - No content gate. A judgement holds a probability, a label and a score, never the text
    it judged, so the input and output permissions have no value to withhold.
  - It joins to `traces` on the tenant and the trace id, and its time column is when the
    judgement was written.

  @unit
  Scenario: The dataset is listed for every caller
    When the catalog entry is read
    Then the dataset carries no content gate
    And no column of it carries one either

  @unit
  Scenario: The dataset declares its join keys and its time column
    When the catalog entry is read
    Then it joins on the tenant and the trace id
    And its partition-pruning time column is when the judgement was written

  @integration
  Scenario: A judgement written by one project is invisible to another
    Given a judgement written for another project
    When this project reads the run's judgements
    Then the judgement is not returned

  @integration
  Scenario: Judgements join back to traces on the trace id
    Given a judgement over a trace this project can read
    When the judgements are joined to the traces table on the tenant and the trace id
    Then the joined row carries both the verdict and the trace

  @integration
  Scenario: Counting labels of a finished run is one grouped query
    Given a finished category run
    When the labels are counted from the judgements table
    Then the counts match the run's own matched-per-question totals
