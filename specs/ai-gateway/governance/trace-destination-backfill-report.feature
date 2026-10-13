# Read-only. Ported from main's scripts/report-trace-destination-backfill.ts
# onto the task launcher. It answers, before the stored-trace-destination
# backfill runs, the one question the backfill cannot answer for itself.

Feature: Trace destination backfill report
  As an operator about to run the stored-trace-destination backfill
  I want to know which keys it would leave with no destination
  So that the data is fixed by hand first rather than by the migration

  @unit
  Scenario: The trace-destination report classifies every key by the rule that would answer for it
    Given virtual keys naming a live project, an archived project and another organization's project
    And a key with a single live project scope, and a key with nothing at all
    When the report runs
    Then each key is counted under the rule that would answer for it
    And a key naming a project of another organization counts the same as one naming a project that is gone

  @unit
  Scenario: The trace-destination report names the organizations that gate the migration
    Given an organization with no live governance project and a key with nothing to fall back on
    When the report runs
    Then that key counts as having no destination at all
    And the organization is named, because that count is fixed by hand before the migration
