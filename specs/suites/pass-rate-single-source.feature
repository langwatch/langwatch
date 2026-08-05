Feature: One pass rate, everywhere
  As someone reading how a run went
  I want every surface that quotes a pass rate to quote the same one
  So that a number I act on cannot depend on which screen I read it from

  # "What fraction passed" is currently answered by three separate calculations —
  # the run history panel, a ClickHouse aggregation behind the sidebar, and
  # another behind the batch history API — and they bucket stalled and cancelled
  # runs differently. That was survivable while each number stayed on its own
  # screen. It stops being survivable the moment a report quotes one of them,
  # because a report is read away from the screen it came from and cannot be
  # sanity-checked against it.
  #
  # The run history panel's answer is canonical: a run's outcome bucket is
  # derived from its status, and the pass rate is passed over settled. This file
  # pins that calculation as a thing in its own right, so anything that needs it
  # calls it rather than reimplementing it.

  # ============================================================================
  # The canonical calculation
  # ============================================================================

  @unit
  Scenario: Pass rate is passed over settled
    Given 3 passed, 1 failed, 1 stalled, and 1 cancelled run
    Then the pass rate is 50%

  # A run still going has no outcome yet, so counting it either way would state
  # something we do not know.
  @unit
  Scenario: Runs still going are outside the pass rate
    Given 2 passed runs and 2 runs still in progress
    Then the pass rate is 100%

  @unit
  Scenario: Queued runs are outside the pass rate
    Given 2 passed runs and 2 queued runs
    Then the pass rate is 100%

  # A run that stalled or was cancelled did not pass. Leaving it out of the
  # denominator would quietly round the pass rate up.
  @unit
  Scenario: Stalled runs count against the pass rate
    Given 2 passed runs and 1 stalled run
    Then the pass rate is 67%

  @unit
  Scenario: Cancelled runs count against the pass rate
    Given 2 passed runs and 1 cancelled run
    Then the pass rate is 67%

  # Nothing has settled, so there is no answer yet. Reporting 0% would read as
  # "everything failed", which is a different claim from "we do not know".
  @unit
  Scenario: A group with nothing settled has no pass rate rather than zero
    Given 3 runs that are all still in progress
    Then the group has no pass rate

  @unit
  Scenario: A group with no runs at all has a pass rate of zero
    Given no runs
    Then the pass rate is 0%

  # A run that errored and a run that failed its criteria both mean "did not
  # pass", and both are counted the same way, but the distinction still matters
  # when reading a single run — so the bucket is derived from the status rather
  # than replacing it.
  #
  # These are every value of ScenarioRunStatus. The ClickHouse aggregations
  # additionally accept a legacy 'FAILURE' string that the enum has never had;
  # widening the enum to match would change counts already on screen, so it is
  # recorded as a known divergence here rather than fixed in passing.
  @unit
  Scenario Outline: Every run status lands in exactly one bucket
    Given a run with status <status>
    Then it is counted as <bucket>

    Examples:
      | status      | bucket      |
      | SUCCESS     | passed      |
      | FAILED      | failed      |
      | ERROR       | failed      |
      | STALLED     | stalled     |
      | CANCELLED   | cancelled   |
      | IN_PROGRESS | in progress |
      | PENDING     | in progress |
      | RUNNING     | in progress |
      | QUEUED      | queued      |

  # Two counts are derived rather than tallied, and both are quoted on screen,
  # so they are pinned here rather than left as arithmetic nobody checks.
  @unit
  Scenario: Completed counts only the runs that reached a verdict
    Given 3 passed, 1 failed, 1 stalled, and 1 cancelled run
    Then 4 runs are completed
    And 6 runs are settled

  # ============================================================================
  # Agreement
  # ============================================================================

  # The point of the whole exercise: the panel does not carry its own copy of
  # the arithmetic, it calls the canonical one. If these ever disagree, one of
  # them has grown a second implementation.
  @unit
  Scenario: The run history summary reports the canonical pass rate
    Given any collection of scenario runs
    Then the summary shown on the run history panel matches the canonical pass rate
    And its per-outcome counts match the canonical counts

  @unit @unimplemented
  Scenario: A report's headline pass rate equals the screen's for the same run
    Given a run containing passed, failed, stalled, and cancelled scenarios
    When a report is produced for that run
    Then its headline pass rate equals the pass rate shown for that run on screen

  # ============================================================================
  # Known divergences, recorded rather than discovered
  # ============================================================================
  # The two ClickHouse aggregations are not converged here, because converging
  # them changes a percentage that is already on someone's screen. They are
  # written down so the difference is a decision on record, and so the next
  # person to touch one cannot believe they are all the same.

  @unimplemented
  Scenario: The sidebar cannot see a run that stopped reporting without saying so
    Given a set whose latest run has 1 passed scenario and 1 scenario left in
      progress past the point where it counts as stalled
    When the sidebar summarises it
    Then the stalled scenario is outside the settled count
    And the sidebar therefore reports a higher pass rate than the panel

  @unimplemented
  Scenario: The batch history API leaves stalled runs out of its fail count
    Given a run of 1 passed and 1 stalled scenario
    When the batch history API summarises it
    Then its pass and fail counts describe only the passed scenario
