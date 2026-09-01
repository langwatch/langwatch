@governance @ingestion
Feature: A broken puller is visible, a flaky one is not
  A cost number that silently stops updating is worse than an error: it reads
  as "we spent nothing". A source that keeps failing must say so on the
  screen, a single flake must not cry wolf, and a day with no data must never
  be shown as zero dollars.
  Decision: ADR-128.

  Background:
    Given an organization with a connected provider source

  @unit
  Scenario: A single failed run does not mark the source unhealthy
    Given the source's last run succeeded
    When one run fails
    Then the source is still considered healthy

  @unit
  Scenario: Three consecutive failed runs mark the source unhealthy
    When three runs in a row fail
    Then the source is marked unhealthy

  @unit
  Scenario: A successful run records its time and resets the failure count
    Given the source has two consecutive failed runs
    When a run succeeds
    # The success time is a NEW field on the source, distinct from the
    # existing last-event time. A test satisfiable by writing lastEventAt
    # proves nothing — ADR-128 disqualifies that field by name, because it
    # only moves when events arrive.
    Then the source's last-successful-run time is updated
    And the consecutive-failure count starts over

  @unit
  Scenario: A run that partly succeeded does not reset the failure count
    Given the source has two consecutive failed runs
    When a run completes but reports errors alongside its progress
    Then the consecutive-failure count is neither reset nor increased
    And the last-successful-run time is not updated
    # A run that delivered something but also hit errors — unreadable rows it
    # stepped over, a next-page link it refused to follow — is not the clean
    # run that proves the source works. Counting it as one stamped a fresh
    # success over exactly the signals that were meant to be loud.

  @unit
  Scenario: A run that finds nothing new still counts as a success
    Given the provider reports no new usage for the period
    When the run completes without error
    Then it counts as a successful run, not a failure
    And the last-successful-run time is updated
    And the last-event time stays unchanged

  @integration
  Scenario: A day with no data is shown as unknown, never as zero
    Given the source has been unhealthy since its last successful pull
    When a viewer looks at a day after that last successful pull
    Then the screen says there is no data since the last successful pull
    And the day is not shown as zero spend
