Feature: Suite table footer info moved to header for clarity
  As a LangWatch user viewing suite run tables
  I want run summary info displayed in the row header instead of a footer
  So that I can immediately see metadata without scrolling past content

  # Previously, run rows and group rows showed summary statistics (total runs,
  # passed, failed, stalled, cancelled counts) in a footer bar below expanded
  # content. The run history list and all-runs panel showed aggregate totals
  # in a footer at the bottom of the list.
  #
  # This feature moves that information into the header area so it is
  # visible at a glance. The existing pass rate percentage and status icon
  # remain in the header; absolute counts are added alongside them.
  #
  # Note: GroupRow already shows "{N} runs" in the header. The change for
  # GroupRow is adding passed/failed counts, not the run total.
  #
  # Note: Aggregate totals track (runCount, passedCount, failedCount) only
  # -- no stalled/cancelled. Stalled/cancelled display applies only to
  # per-row summaries.

  # --- Per-Row Summary (RunRow / GroupRow) ---

  @integration
  Scenario: Run row header displays summary counts alongside existing info
    Given a run row with 10 scenario runs, 8 passed and 2 failed
    When I view the run row header
    Then the header shows "8 passed" and "2 failed" in addition to the existing pass rate and status icon

  @integration
  Scenario: Run row no longer renders a summary footer whether expanded or collapsed
    Given a run row exists
    When I view the run row in either expanded or collapsed state
    Then no summary statistics appear below the row content

  @integration
  Scenario: Group row header additionally displays passed and failed counts
    Given a group row with 5 runs, 4 passed and 1 failed
    When I view the group row header
    Then the header additionally shows "4 passed" and "1 failed"

  @integration
  Scenario: Group row no longer renders a summary footer whether expanded or collapsed
    Given a group row exists
    When I view the group row in either expanded or collapsed state
    Then no summary statistics appear below the row content

  @unit
  Scenario: Stalled and cancelled counts appear only when non-zero (per-row only)
    Given a per-row run summary with 2 stalled and 1 cancelled
    When the summary is rendered in the header
    Then the header shows "2 stalled" and "1 cancelled"

  @unit
  Scenario: Stalled and cancelled counts are hidden when zero
    Given a per-row run summary with 0 stalled and 0 cancelled
    When the summary is rendered in the header
    Then the header does not show stalled or cancelled counts

  # --- Aggregate Totals (RunHistoryList / AllRunsPanel) ---

  @integration
  Scenario: Run history list shows aggregate totals in table header
    Given a suite has run history with multiple batch runs
    When I view the suite detail panel
    Then aggregate passed and failed counts appear in the table header area
    And no aggregate footer appears at the bottom of the list

  @integration
  Scenario: All runs panel shows aggregate totals in table header
    Given multiple suites have run history
    When I view the all runs panel
    Then aggregate passed and failed counts appear in the table header area
    And no aggregate footer appears at the bottom of the list
