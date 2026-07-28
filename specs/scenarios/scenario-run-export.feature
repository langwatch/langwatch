Feature: Scenario run CSV export
  As a LangWatch user looking at simulation run history
  I want to export runs as CSV at the depth I need
  So that I can rank failing criteria, track pass rates over time, and read
  failing transcripts in a spreadsheet instead of clicking through the UI

  # Three modes, because a scenario run is nested (a run CONTAINS a conversation
  # and CONTAINS a list of criteria) and CSV is flat. Each mode picks a
  # different row axis:
  #   summary  — one row per run       → pass rates, cost, duration, trends
  #   criteria — one row per criterion → "which criterion fails most?" (pivot)
  #   full     — one row per message   → read the transcripts
  # All three read the same underlying run record; no mode costs an extra query.

  Background:
    Given I am logged into project "my-project"
    And I am on the simulation Runs page
    And the project has scenario runs with criteria, judge reasoning, and conversations

  # ============================================================================
  # Entry point and mode selection
  # ============================================================================

  Scenario: Export CSV button opens the config dialog
    When I click "Export CSV" in the run history header
    Then an export config dialog appears
    And the dialog shows how many runs match my current filters
    And the mode defaults to "Summary"

  Scenario: The dialog offers all three export depths
    Given the export config dialog is open
    Then I can choose "Summary", "Criteria", or "Full"
    And each option states what one row represents

  Scenario: Export is unavailable when no runs match
    Given no runs match my current filters
    Then the "Export CSV" button is disabled

  # ============================================================================
  # Summary mode — one row per run
  # ============================================================================

  Scenario: Summary CSV writes one row per run
    Given 49 runs match my current filters
    And the export config dialog is open with mode "Summary"
    When I export
    Then the CSV has 49 data rows
    And the CSV contains columns: scenario_run_id, scenario_id, scenario_name, batch_run_id, scenario_set_id
    And the CSV contains columns: status, status_category, verdict, reasoning, error
    And the CSV contains columns: met_criteria, unmet_criteria, met_criteria_count, unmet_criteria_count
    And the CSV contains columns: started_at, finished_at, duration_ms, total_cost
    And the CSV contains columns: target_type, target_reference_id, simulation_suite_id
    And the CSV contains columns: message_count, trace_ids

  Scenario: Summary rows carry criteria counts without needing to parse JSON
    Given a run met 2 criteria and failed 3
    When I export in Summary mode
    Then that row has met_criteria_count "2" and unmet_criteria_count "3"

  # ============================================================================
  # Criteria mode — one row per run x criterion
  # ============================================================================

  Scenario: Criteria CSV writes one row per criterion per run
    Given a run met 2 criteria and failed 3
    And the export config dialog is open with mode "Criteria"
    When I export
    Then that run produces 5 rows
    And each row has a criterion column holding the criterion text
    And each row has a met column that is "true" or "false"

  Scenario: Criteria rows carry enough run context to pivot on
    Given the export config dialog is open with mode "Criteria"
    When I export
    Then each row also includes scenario_run_id, scenario_id, scenario_name, batch_run_id, started_at, and status_category

  Scenario: A run that was judged against no criteria produces no criteria rows
    Given a run has no met criteria and no unmet criteria
    When I export in Criteria mode
    Then that run contributes no rows
    And the other runs still export normally

  Scenario: Criteria mode makes the failing-criteria ranking a spreadsheet pivot
    Given a criterion failed in 18 different runs
    When I export in Criteria mode
    Then grouping the file by criterion where met is "false" counts 18 rows for it

  # ============================================================================
  # Full mode — one row per message
  # ============================================================================

  Scenario: Full CSV writes one row per conversation message
    Given a run has a 12-message conversation
    And the export config dialog is open with mode "Full"
    When I export
    Then that run produces 12 rows
    And each row includes message_index, message_id, message_role, message_content, message_trace_id

  Scenario: Full rows repeat the run fields on every message row
    Given a run has a 12-message conversation
    When I export in Full mode
    Then every one of those 12 rows carries the same run_scenario_run_id and run_verdict

  Scenario: A run with no messages still appears in Full mode
    Given a run finished with an error before producing any messages
    When I export in Full mode
    Then that run produces exactly one row
    And its message columns are empty

  # ============================================================================
  # Status: the file must agree with the screen
  # ============================================================================

  # The export resolves status through the same mapper the run history UI uses,
  # so stall detection and legacy-value normalisation apply identically. A run
  # shown as stalled on screen exports as stalled; it is never possible for the
  # CSV and the UI to disagree about a run's outcome.

  Scenario: Every row reports both the run's status and its category
    Given a run has status "SUCCESS"
    When I export
    Then that row has status "SUCCESS" and status_category "success"

  Scenario: Statuses that mean failure are categorised together but still distinguishable
    Given a run failed its criteria
    And another run errored before it could be judged
    When I export
    Then both rows have status_category "failure"
    And their status columns read "FAILED" and "ERROR" respectively

  Scenario: A run that stalled exports as stalled
    Given a run stopped emitting events long enough to be considered stalled
    And the run history shows it as stalled
    When I export
    Then its status column reads "STALLED"
    And its status_category column reads "stalled"

  Scenario: The export computes no pass rate of its own
    When I export in any mode
    Then the CSV contains no aggregate row and no pass_rate column
    # Pass rate is derived in two places already (run-history-transforms.ts and
    # the sidebar ClickHouse aggregation). A third copy here would drift from
    # the number shown on screen. The file carries per-run categories; the
    # spreadsheet does the arithmetic.

  # ============================================================================
  # Value encoding — the part that is a public contract
  # ============================================================================

  Scenario: Criteria are encoded so that their commas survive
    Given a criterion reads "stays polite, even when the customer escalates"
    When I export in Summary mode
    Then the met_criteria cell holds a JSON array
    And reading that cell back yields the criterion with its comma intact

  Scenario: Timestamps are written as ISO-8601 UTC
    Given a run started at 2026-07-27 18:48:35.009 UTC
    When I export
    Then its started_at cell reads "2026-07-27T18:48:35.009Z"

  Scenario: Timestamps that do not exist yet are left empty
    Given a run has not finished
    When I export
    Then its finished_at cell is empty
    And its duration_ms cell is empty

  Scenario: Conversation content keeps its commas, quotes, and newlines
    Given a message contains commas, double quotes, and newlines
    When I export in Full mode
    Then the file is still valid CSV
    And the message content round-trips unchanged

  # ============================================================================
  # Scope — the export matches what I am looking at
  # ============================================================================

  Scenario: Export honours the selected date range
    Given the date range is "Last 30 days"
    When I export
    Then only runs started within the last 30 days are included

  Scenario: Export honours the scenario filter
    Given I have filtered the list to scenario "Refund Request"
    When I export
    Then only runs of "Refund Request" are included

  Scenario: Export honours the pass/fail filter
    Given I have filtered the list to "Fail"
    When I export
    Then only runs whose status_category is not "success" are included

  Scenario: Export from a scenario set is scoped to that set
    Given I am viewing the run history for scenario set "agq-seed-set"
    When I export
    Then only runs belonging to that set are included

  Scenario: Archived runs are excluded
    Given some runs have been archived
    When I export
    Then archived runs do not appear in the file

  # ============================================================================
  # Delivery
  # ============================================================================

  Scenario: The file downloads with a descriptive name
    Given my project is "my-project" and today is 2026-07-28
    And the export config dialog is open with mode "Criteria"
    When I export
    Then the downloaded file is named "my-project - Scenario Runs - 2026-07-28 - criteria.csv"

  Scenario: Progress is shown while a large export streams
    Given 5000 runs match my current filters
    When I export
    Then a progress indicator reports how many runs have been written so far
    And the progress reaches the total when the download completes

  Scenario: The header row is written once
    Given enough runs to require several batches
    When I export
    Then the file contains exactly one header row

  Scenario: Cancelling an in-flight export stops it
    Given an export is streaming
    When I cancel it
    Then the progress indicator disappears
    And no further data is written

  # ============================================================================
  # Authorization
  # ============================================================================

  Scenario: Export requires permission to view scenarios
    Given I do not have the "scenarios:view" permission for this project
    When I attempt to export scenario runs
    Then the export is denied with an authorization error

  Scenario: Export is scoped to my own project
    Given another project has scenario runs
    When I export from my project
    Then no runs from the other project appear in the file
