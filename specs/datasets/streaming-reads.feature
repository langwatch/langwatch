Feature: Experiments run on the whole dataset (ADR-033 streaming reads)
  As a user with a large (multi-GB, image) dataset
  I want experiments to run on every row without the platform running out of memory
  So that my evaluation reflects the whole dataset, not a silently truncated 5 MB prefix

  Background:
    Given the dataset content lives in S3 JSONL chunks (ADR-032)
    And each saved dataset row has a stable id

  # ── Slice 1: reference plumbing (the red-team Blocker-1 fix) ──────────────────
  Rule: a run result references the dataset row it evaluated by its stable id

    Scenario: a target result carries the dataset row reference
      Given a saved dataset with rows that have stable ids
      When an experiment runs and records a target result for a row
      Then the result carries the dataset id and the stable row id of that row
      And the reference is stored in the reserved namespace, not as a visible column

    Scenario: an inline dataset has no stable id and stays full-copy
      Given an inline dataset (no saved rows, no stable ids)
      When an experiment runs and records a target result
      Then the result has no row reference
      And the full row is kept inline (today's behavior)

    Scenario: the reference resolves the original row, project-scoped
      Given a target result that references a dataset row by id
      When the row is resolved for display
      Then it is looked up within the result's project only
      And a reference to another project's row resolves to nothing

  # ── Later slices (acceptance for the epic; not all green in slice 1) ──────────
  Rule: large datasets execute fully without truncation or OOM

    Scenario: a dataset larger than 5 MB runs every row
      Given a saved dataset whose serialized content exceeds 5 MB
      When an experiment runs over it
      Then every row is executed, not just the first 5 MB

    Scenario: heavy rows are dispatched by pointer, never inline over the cap
      Given a dataset row whose serialized size exceeds the staging threshold
      When the row is dispatched to the engine
      Then it is staged to object storage and dispatched by reference
      And an un-stageable row fails loudly rather than truncating silently

  Rule: results store a lean shape, not a second copy of the data

    Scenario: heavy columns are referenced, light columns inline
      Given a run result for a row with a heavy image column and light text columns
      When the result is stored with the streaming-reads flag on
      Then the light text columns are kept inline
      And the heavy image column is replaced by a reference resolved at read

    Scenario: a deleted dataset row degrades, never crashes
      Given a stored result that references a now-deleted dataset row
      When the result is displayed
      Then the light columns still render
      And the heavy column shows "unavailable"

  Rule: the change is gated and backward compatible

    Scenario: flag off is byte-for-byte today
      Given the streaming-reads flag is off
      Then reads cap at 5 MB and results keep the full-row copy, unchanged

    Scenario: a large run asks for confirmation
      Given a run over the large-run row threshold
      When the user starts it
      Then they are asked to confirm before it dispatches
