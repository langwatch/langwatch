Feature: Run report
  As someone who just ran a scenario suite
  I want one report per run that explains what failed and what to do about it
  So that I can act on the result instead of reading a list of red and green rows

  # A run report is scoped to ONE run — the top-level row in run history, the
  # thing a person means when they say "the run I did after I changed the
  # prompt". A project-wide report would answer a question nobody asks.
  #
  # The report is built in two halves that fail independently. The FIGURES are
  # computed from the run data and are always present. The WRITING is produced
  # by a model, and every sentence of it is traced back to a run before it is
  # allowed into the file. When the writing cannot be produced, or cannot be
  # traced, the figures still download and the absence is stated on the page.
  #
  # The report answers a declared list of questions grouped into what happened,
  # what is true now, and what to do next. A question the evidence cannot answer
  # is shown as a gap. It is never quietly dropped, because a missing section and
  # an unanswerable question look identical to a reader and mean opposite things.

  Background:
    Given I am logged into project "my-project"
    And I am on the simulation Runs page
    And the run history shows a run of several scenarios

  # ============================================================================
  # Getting one
  # ============================================================================

  @integration
  Scenario: Every run offers a report
    Then each run in the history offers to export a report

  @integration
  Scenario: The report covers the run I asked for
    Given the history shows more than one run
    When I export a report for the second run
    Then the report covers only that run's scenarios

  # Asking costs money and time, so the count is shown before the wait, not
  # after it.
  @integration
  Scenario: I am told what the report will cover before I wait for it
    When I choose to export a report
    Then I am told how many scenarios it will cover

  @integration
  Scenario: Exporting a report leaves the run history alone
    When I export a report from a run's row
    Then the row does not expand or collapse

  @integration
  Scenario: Two reports can be produced at once
    When I export a report for one run and then another before the first finishes
    Then both continue independently

  @integration
  Scenario: Cancelling a report in progress stops it
    Given a report is being produced
    When I cancel it
    Then no file is downloaded

  # ============================================================================
  # Honest arithmetic
  # ============================================================================

  # The whole feature rests on this. A report read away from the screen has
  # nothing to be checked against, so it has to agree with the screen it came
  # from.
  @unit
  Scenario: The report never disagrees with the screen
    Given the run history shows a pass rate for a run
    When I export a report for that run
    Then the report states the same pass rate

  @unit
  Scenario: A run shown as stalled is reported as stalled
    Given a scenario stopped reporting long enough to count as stalled
    When I export a report
    Then it is counted as stalled rather than as still running

  # Three failures out of four is not a 75% failure rate in any sense worth
  # acting on. Saying so invites someone to rewrite a prompt over noise.
  @unit
  Scenario: A small sample is reported as a small sample
    Given a run of 4 scenarios where 3 failed
    When I export a report
    Then the report says how many failed out of how many
    And it says there were too few runs to draw a conclusion
    But it does not state a failure percentage on its own

  @unit
  Scenario: A large enough sample states its rate with a margin
    Given a run of 200 scenarios
    When I export a report
    Then the report states the pass rate
    And it states the range the true rate is likely to sit in

  @unit
  Scenario: A run still in progress reports only what has finished
    Given a run has finished 6 of its 10 scenarios
    When I export a report
    Then the report states that it covers only the scenarios that had finished

  # ============================================================================
  # Why things failed — grouping by cause, not by row
  # ============================================================================

  # Eight failing rows are often two problems. Listing them individually is the
  # thing the run history already does, and it is what makes a long failure list
  # feel unactionable.
  @unit
  Scenario: Failures are grouped by what went wrong
    Given three scenarios failed the same criterion and one failed a different one
    When I export a report
    Then the failures appear as two groups
    And each group lists the scenarios that belong to it

  @unit
  Scenario: A group cannot claim a scenario that did not fail
    When I export a report
    Then every scenario listed under a failure group actually failed in this run

  # A scenario that errored before it could be judged did not reveal anything
  # about the agent, and grouping it with genuine failures buries the ones that
  # did.
  @unit
  Scenario: Infrastructure errors are separated from judged failures
    Given one scenario failed its criteria and another errored before being judged
    When I export a report
    Then they are not grouped together

  # A run can hold far more failing conversations than can be read at once. The
  # sample is chosen so that every distinct kind of failure is represented
  # before any one kind gets a second example — but a report that read a
  # quarter of the evidence and does not say so is claiming more than it
  # checked.
  @unit
  Scenario: Reading a sample of conversations is disclosed
    Given a run has far more failing conversations than can be read at once
    When I export a report
    Then the report states how many failing conversations were read
    And every distinct kind of failure is represented among them

  # Naming a criterion says what broke, never why. The conversation is the only
  # part of the document a reader can check the rest against, so it travels with
  # the failure group it belongs to rather than living in a separate appendix.
  @unit
  Scenario: I can read the conversation behind a failure
    Given a run has a failing scenario
    When I export a report
    Then the failure group shows the conversation that failed
    And each turn is labelled with who spoke and when

  # The sample keeps the opening turn and the tail, because an escalation fails
  # at its end. A reader following one needs to know where the jump was, so the
  # gap is marked in the place it happened.
  @unit
  Scenario: A conversation with a dropped middle says where the gap is
    Given a failing conversation was too long to include whole
    When I export a report
    Then the omitted turns are marked between the turns either side of them

  @unit
  Scenario: The report names the turn where a conversation went wrong
    Given a scenario failed partway through a conversation
    When I export a report
    Then the report points at the turn where it went wrong

  @unit
  Scenario: A turn that does not exist is never pointed at
    Given the analysis points at a turn beyond the end of a conversation
    When I export a report
    Then no turn is pointed at for that scenario

  # ============================================================================
  # What matters most
  # ============================================================================

  @unit
  Scenario: The most consequential failure is the first one I read
    Given a run has failures of differing consequence
    When I export a report
    Then the failures are ordered with the most consequential first

  @unit
  Scenario: A failure that keeps happening outranks a one-off
    Given one criterion failed in many scenarios and another failed in one
    When I export a report
    Then the widespread failure is ranked higher

  # ============================================================================
  # What held, and what was never tried
  # ============================================================================

  @unit
  Scenario: The report says what held up
    Given some criteria passed in every scenario that checked them
    When I export a report
    Then the report names them as holding

  @unit
  Scenario: The report says what was not attempted
    Given the suite contains scenarios that this run did not execute
    When I export a report
    Then the report lists what was not attempted

  @unit
  Scenario: A run that covered everything says so
    Given the run executed every scenario in its suite
    When I export a report
    Then the report says nothing was left unattempted

  # ============================================================================
  # Trend — the present only means something against the past
  # ============================================================================

  @unit
  Scenario: A criterion that used to pass and now fails is called a regression

  @unit
  Scenario: A criterion that used to fail and now passes is called fixed

  @unit
  Scenario: A criterion that has failed every time is called long-standing

  # A criterion flipping back and forth is not regressing each time it flips.
  # Calling it a regression sends someone hunting for a change that never
  # happened.
  @unit
  Scenario: A criterion that keeps changing its mind is called unreliable
    Given a criterion has alternated between passing and failing across recent runs
    When I export a report
    Then it is reported as unreliable rather than as a regression

  @unit
  Scenario: The first run of a suite reports no trend
    Given a run is the first run of its suite
    When I export a report
    Then the trend section says there is nothing to compare against
    And the rest of the report is unaffected

  # A report can be exported long after the run it describes, by which time the
  # suite has run again. Comparing against those would reverse every verdict a
  # reader acts on: a criterion that only starts passing later would be
  # reported as having broken.
  @unit
  Scenario: A run is only ever compared against runs that preceded it
    Given a suite has run again since the run being reported on
    When I export a report for the earlier run
    Then the later runs are not treated as its history

  @unit
  Scenario: A criterion never seen before is not called a regression
    Given a scenario was added since the last run
    When I export a report
    Then its criteria are reported as new rather than as regressions

  # ============================================================================
  # What to do next
  # ============================================================================

  @unit
  Scenario: The report proposes work, not advice
    Given a run has failures
    When I export a report
    Then each proposal is presented as something I can copy and use as it stands

  @unit
  Scenario: A proposal that cannot be traced to a failure is not offered

  # ============================================================================
  # Every statement is traceable — the contract that makes it forwardable
  # ============================================================================

  @unit
  Scenario: A statement citing a scenario that does not exist is removed
    Given the analysis produces a statement referring to a scenario not in this run
    When I export a report
    Then that statement does not appear in the report

  @unit
  Scenario: A statement with nothing behind it is removed
    Given the analysis produces a statement citing nothing
    When I export a report
    Then that statement does not appear in the report

  @unit
  Scenario: Removed statements are counted rather than hidden
    Given statements were removed from a report
    Then the report states how many were removed and why

  @unit
  Scenario: A question left with nothing to say is shown as a gap
    Given every statement answering one of the report's questions was removed
    When I export a report
    Then that question still appears
    And it says there is not enough evidence to answer it

  @unit
  Scenario: A statement the check could not confirm is removed
    Given the second reading cannot confirm a statement against the run data
    When I export a report
    Then that statement does not appear
    And the statements it could confirm still do

  # An unreviewed statement is not a confirmed statement, so the check failing
  # to mention one is treated the same as rejecting it.
  @unit
  Scenario: A statement the check never mentioned is removed

  # But a check that came back mostly empty is a broken check, not a verdict
  # that everything was wrong. Emptying the report would be the wrong reading.
  @unit
  Scenario: A check that came back mostly empty is discarded rather than obeyed
    Given the second reading returned almost no verdicts
    When I export a report
    Then the report keeps its statements
    And it says they could not be independently checked

  # ============================================================================
  # The report answers what it set out to answer
  # ============================================================================

  @unit
  Scenario: Every question the report asks appears in it
    When I export a report
    Then each of the report's questions appears as its own section
    And each section either answers the question or says why it cannot

  @unit
  Scenario: Questions are grouped into what happened, what is true now, and what to do next

  # ============================================================================
  # It always downloads
  # ============================================================================

  @unit
  Scenario: A report still downloads when no model is configured
    Given no model is configured for run reports
    When I export a report
    Then the file still downloads
    And it contains the figures for the run
    And it states that the written analysis is unavailable

  @unit
  Scenario: A report still downloads when the analysis fails

  @unit
  Scenario: A report still downloads when the check fails
    Given the second reading cannot be completed
    When I export a report
    Then the file still downloads
    And it states that the analysis could not be independently checked

  @unit
  Scenario: The report says how it was produced
    When I export a report
    Then it states which parts were computed and which were written

  # ============================================================================
  # The file itself
  # ============================================================================

  @unit
  Scenario: The report opens with no network access
    Given I have downloaded a report
    When I open it on a machine with no internet connection
    Then it renders completely

  @unit
  Scenario: Text from the analysis is shown as text
    Given the analysis produces a statement containing angle brackets and quotes
    When I open the report
    Then the statement reads exactly as written
    And nothing in it is treated as part of the page

  @unit
  Scenario: A scenario named like markup is shown as text

  @unit
  Scenario: Failure detail is hidden until I ask for it

  @unit
  Scenario: Printing the report produces a clean document
    Given I have downloaded a report
    When I print it
    Then the failure detail is included rather than collapsed away
    And the controls I would click on screen are not printed

  @unit
  Scenario: The same run produces the same report twice
    When I export a report for the same run twice without the run changing
    Then the two files are identical

  @unit
  Scenario: The file downloads with a descriptive name

  @unit
  Scenario: A run named with characters that break filenames still downloads

  # ============================================================================
  # Authorization
  # ============================================================================

  @integration
  Scenario: A report requires permission to view scenarios
    Given I do not have the "scenarios:view" permission for this project
    When I request a report
    Then it is denied with an authorization error

  @integration
  Scenario: A report is scoped to my own project
    Given another project has a run
    When I request a report for that run
    Then it is not produced

  @integration
  Scenario: Producing a report is recorded
    When I export a report
    Then the request is recorded against my user before any of it is written

  @integration
  Scenario: Asking for a run that does not exist is refused
