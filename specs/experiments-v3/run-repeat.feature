Feature: Repeat every dataset row of an experiment run

  A model rarely answers the same way twice, so one pass over a dataset says
  little about how often a row passes. A run started through the run API, the
  CLI or the SDK can ask for a repeat: every dataset row then runs that many
  times against every target, on the server, in one run. The results keep one
  row per repetition and add a pass rate per dataset row and target, both in
  the CLI output and on the run's results page. A repeated run never writes its
  outputs back into the workbench, because the workbench holds one cell per row.

  Background:
    Given a saved experiment "my-evaluation" with one target, one evaluator and 2 dataset rows

  # ==========================================================================
  # Run API
  # ==========================================================================

  @unit
  Scenario: A repeated run plans every dataset row that many times
    When a run of "my-evaluation" is planned with a repeat of 3
    Then the plan holds 6 cells
    And dataset row 1 runs as run rows 1, 2 and 3, and dataset row 2 as run rows 4, 5 and 6
    And the plan records a repeat of 3

  @unit
  Scenario: A repeated run over chosen rows repeats only those rows
    When a run of "my-evaluation" is planned with a repeat of 2 over dataset row 2 only
    Then the plan runs run rows 3 and 4 only

  @integration
  Scenario: A run call that names a repeat plans the repeated run and keeps the workbench as it is
    When I POST to /api/experiments/my-evaluation/run with body:
      """json
      { "repeat": 3 }
      """
    Then the run starts with a repeat of 3
    And the run does not write its outputs back into the workbench

  @integration
  Scenario: A run call with a repeat of 1 runs every row once, as before
    When I POST to /api/experiments/my-evaluation/run with body:
      """json
      { "repeat": 1 }
      """
    Then the run starts with no repeat recorded

  @integration
  Scenario Outline: A run call with a repeat outside 1 to 5 is refused
    When I POST to /api/experiments/my-evaluation/run with body:
      """json
      { "repeat": <repeat> }
      """
    Then I receive 400 Bad Request with code "experiment_evaluation_input_invalid"
    And no run is started

    Examples:
      | repeat |
      | 0      |
      | 6      |
      | 1.5    |

  @unit
  Scenario: The run keeps the repeat its plan carried
    Given a run started with a plan whose repeat is 3
    When the start is folded into the run's state and read back
    Then the run reads a repeat of 3
    And its targets read without the stored repeat in their metadata

  @integration
  Scenario: A stored repeated run reads back its repeat
    Given a run stored with a repeat of 3
    When the run and the experiment's run list are read
    Then both carry a repeat of 3
    And a run stored with no repeat reads a repeat of null

  # ==========================================================================
  # CLI
  # ==========================================================================

  @unit
  Scenario: The experiment run command passes its repeat flag on the run
    When I run `langwatch experiment run my-evaluation --repeat 3`
    Then the run starts with a repeat of 3

  @unit
  Scenario Outline: The experiment run command refuses a repeat that is not a whole number from 1 to 5
    When I run `langwatch experiment run my-evaluation --repeat <repeat>`
    Then the command prints "--repeat takes a whole number from 1 to 5"
    And the command exits non-zero
    And no run is started

    Examples:
      | repeat |
      | 0      |
      | 6      |
      | 1.5    |
      | many   |

  @unit
  Scenario: A waited repeated run prints the pass rate of every dataset row
    Given a run of "my-evaluation" with a repeat of 3 that completed
    And dataset row 1 passed its evaluator in 2 of its 3 runs and dataset row 2 in 3 of 3
    When I run `langwatch experiment run my-evaluation --repeat 3 --wait`
    Then the output lists dataset row 1 at "2/3 passed (67%)" and dataset row 2 at "3/3 passed (100%)"
    And the JSON output carries the same pass rates under rowPassRates

  # The run's Score counts pass and fail verdicts only and leaves an errored
  # evaluation out. The pass rate follows it, so the two never disagree.

  @unit
  Scenario: An errored repetition is left out of the pass rate and counted as an error
    Given a repeated run where one repetition of a row errored in its target
    And another repetition's evaluator call errored
    When the pass rates are counted
    Then neither errored repetition counts as passed or failed
    And the pass rate counts them as errors, such as "1/1 passed (100%), 2 errors"
    And a repetition whose evaluators returned no pass or fail verdict is left out of the count

  # ==========================================================================
  # MCP
  # ==========================================================================

  @unit
  Scenario: The MCP run tool passes its repeat on the run
    When an agent calls platform_run_experiment for "my-evaluation" with a repeat of 3
    Then the run request body carries a repeat of 3
    And the tool's answer says every dataset row runs 3 times

  @unit
  Scenario Outline: The MCP run tool refuses a repeat that is not a whole number from 1 to 5
    When an agent calls platform_run_experiment for "my-evaluation" with a repeat of <repeat>
    Then the tool input is refused on its repeat
    And no run is started

    Examples:
      | repeat |
      | 0      |
      | 6      |
      | 1.5    |

  @unit
  Scenario: The MCP run tool tells an agent to repeat rows to tell noise from real failures
    When an agent lists the MCP tools
    Then the platform_run_experiment description tells it to run again with a repeat before calling a failing row a real failure

  # ==========================================================================
  # Results page
  # ==========================================================================

  @integration
  Scenario: The results page shows a repeated run's pass rate per dataset row
    Given a run with a repeat of 3 over 2 dataset rows
    When the results page shows that run
    Then every run row is numbered by its dataset row and repetition, such as "1 · 2/3"
    And a "Pass rate" column shows each row's dataset row pass rate per target, such as "2/3"
    And the run's title and its run list entry read "Repeat 3"

  @integration
  Scenario: The results page leaves an errored evaluation out of a row's pass rate
    Given a run with a repeat of 3 where one repetition's evaluator call errored
    When the results page shows that run
    Then that dataset row's pass rate counts the error apart, such as "2/2 · 1 error"

  @integration
  Scenario: The results page shows an unrepeated run as before
    Given a run with no repeat
    When the results page shows that run
    Then no "Pass rate" column is shown and rows are numbered 1, 2, 3
