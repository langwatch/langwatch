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
    Then the time of that success is recorded on the source
    And the consecutive-failure count starts over

  @unit
  Scenario: A run that finds nothing new still counts as a success
    Given the provider reports no new usage for the period
    When the run completes without error
    Then it counts as a successful run, not a failure

  @integration
  Scenario: A day with no data is shown as unknown, never as zero
    Given the source has been unhealthy since its last successful pull
    When a viewer looks at a day after that last successful pull
    Then the screen says there is no data since the last successful pull
    And the day is not shown as zero spend
