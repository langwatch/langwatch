Feature: A run carries a snapshot of the board
  As a person comparing columns in the workbench
  I want a run to hold the whole board as it stood when I started it
  So that opening the run shows what I was looking at, not one column

  # One click is still one run. The small play arrow on a column mints a run
  # the same way the top-level Run button does, and that stays simple to
  # explain. What changed is what a run CONTAINS: the cells outside the
  # execution scope are copied into the run from the board, and the cells being
  # run fill in as they execute.
  #
  # Before this, a scoped run declared every column in its target metadata but
  # held rows for one of them, so the results page drew a column with no data
  # in it.

  # ==========================================================================
  # Carrying the board in
  # ==========================================================================

  @unit
  Scenario: A run of one column carries the other columns from the board
    Given a board with two columns that both have results
    When I run one column
    Then the run carries the other column's cells as they stood on the board
    And the run does not carry the cells of the column I ran

  @unit
  Scenario: A run of one column carries the other columns' verdicts too
    Given a board with two columns that both have verdicts from one evaluator
    When I run one column
    Then the run carries the other column's verdicts

  @unit
  Scenario: A run of one column carries the other columns' failures too
    Given a board with a column whose first row failed
    When I run a different column
    Then the run carries that failure as it stood on the board

  @unit
  Scenario: A full run carries nothing
    Given a board with two columns that both have results
    When I run every column
    Then the run carries no cells from the board

  @unit
  Scenario: A run of one row carries the other rows
    Given a board with two rows that both have results
    When I run one row
    Then the run carries the other row's cells

  @unit
  Scenario: A cell with nothing on the board is not carried
    Given a board with a column that has results for the first row only
    When I run a different column
    Then only the first row of the untouched column is carried

  @unit
  Scenario: A run with no board behind it carries nothing
    Given a board with no results at all
    When I run one column
    Then the run carries no cells from the board

  # ==========================================================================
  # A carried cell cost nothing and took no time in this run
  # ==========================================================================

  # The run's folded totals feed cost reporting. A cell copied from the board
  # was paid for by an earlier run, so counting its money again reports spend
  # that did not happen. Time works the same way, and so does progress: the
  # run's total counts the cells it dispatched, so a carried cell that
  # incremented the completed count would report a run as more than finished.

  @unit
  Scenario: A carried-over output adds nothing to the run's cost
    Given a run that carried an output which cost money when it was produced
    When the run's totals are folded
    Then the run's total cost does not include the carried output

  @unit
  Scenario: A carried-over output adds nothing to the run's duration
    Given a run that carried an output which took time when it was produced
    When the run's totals are folded
    Then the run's total duration does not include the carried output

  @unit
  Scenario: A carried-over output does not move the run's progress
    Given a run that carried an output from the board
    When the run's totals are folded
    Then the run's completed count and progress stay where they were

  @unit
  Scenario: A carried-over failure does not move the run's failed count
    Given a run that carried a failed cell from the board
    When the run's totals are folded
    Then the run's failed count stays where it was

  @unit
  Scenario: A carried-over verdict adds nothing to the run's cost
    Given a run that carried a verdict which cost money when it was produced
    When the run's totals are folded
    Then the run's total cost does not include the carried verdict

  # The run stands for the board, and a reader comparing two columns needs both
  # sides of the comparison. So a carried verdict counts toward what the run
  # scored, even though its money does not.

  @unit
  Scenario: A carried-over verdict counts toward the run's pass rate
    Given a run that carried a verdict which passed
    And the run produced a verdict of its own which failed
    When the run's totals are folded
    Then the run's pass rate covers both verdicts

  @unit
  Scenario: A carried-over verdict counts toward the run's average score
    Given a run that carried a scored verdict
    When the run's totals are folded
    Then the run's average score covers the carried verdict

  @unit
  Scenario: A cell the run produced still counts its own cost
    Given a run that produced an output which cost money
    When the run's totals are folded
    Then the run's total cost includes that output

  # One case holds both halves of the rule together, so neither half can drift
  # back on its own.

  @unit
  Scenario: A run that carries two columns and runs one splits money from verdicts
    Given a run that carried two columns and ran a third
    And every column produced a verdict and cost money
    When the run's totals are folded
    Then the run's pass rate covers all three columns
    And the run's total cost covers only the column it ran

  # ==========================================================================
  # What the stored row says
  # ==========================================================================

  @unit
  Scenario: A carried-over row is marked as carried over
    Given a target result recorded as carried over
    When it is stored
    Then the stored row is marked as carried over

  @unit
  Scenario: A row the run produced is not marked as carried over
    Given a target result recorded by the run itself
    When it is stored
    Then the stored row is not marked as carried over

  @unit
  Scenario: A carried-over verdict is marked as carried over
    Given an evaluator result recorded as carried over
    When it is stored
    Then the stored row is marked as carried over

  # ==========================================================================
  # What the run reports it spent
  # ==========================================================================

  @unit
  Scenario: The run's cost summary leaves carried rows out
    Given a run whose items include carried rows and rows it produced
    When the run's cost and duration summary is read
    Then only the rows the run produced are counted

  @unit
  Scenario: The run's evaluator breakdown keeps carried rows
    Given a run whose items include carried verdicts
    When the run's per-evaluator breakdown is read
    Then the carried verdicts are counted

  # ==========================================================================
  # Two columns end to end
  # ==========================================================================

  # A carried column and a running column produce a verdict for the same
  # evaluator on the same row. Those are two different facts and both have to
  # survive to storage. Carrying the board in is what makes a run with two
  # columns the normal case rather than a rare one.

  @integration
  Scenario: A snapshot run keeps both columns' verdicts
    Given a run that carries one column and runs another
    And both columns are scored by the same evaluator on the same row
    When the run stores its results
    Then both columns' verdicts are readable from the run
    And each verdict keeps its own score
