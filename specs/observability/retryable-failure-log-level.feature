Feature: What log level a failure earns, and who gets to decide it

  `error` is a claim that something bad and final happened. A failure that is
  about to be retried is neither. It is an attempt that did not work yet, and
  the run it belongs to may well succeed on the next one — so a record at
  `error` for it is a false positive, and a fleet of them trains everyone to
  scroll past the level that was supposed to mean "stop what you are doing".

  This is a separate axis from the one
  `specs/observability/request-log-cause-and-level.feature` describes. That spec
  levels a request by *fault*: a customer fault is expected traffic and logs
  below error, a platform fault logs at error. This one levels by *finality*. A
  platform fault that will be retried is still not final, so fault alone does
  not settle it.

  The rule the queue already follows, and that the layers underneath it do not:

    A layer that rethrows has not decided the outcome, so it does not get to
    claim one. It logs at warning, with whatever local identifiers only it
    holds. The layer that stops the propagation — the retry loop that ran out
    of attempts, the boundary that answered the caller — is the layer that logs
    at error.

  `GroupQueue` is the reference implementation. It logs "Job attempt failed,
  re-staged with backoff" at warning on every attempt, and "Group blocked after
  exhausted retries, job re-staged" at error exactly once, when it gives up.
  Repositories beneath it were logging at error on every single attempt of work
  the queue then retried successfully, which is how three overnight pages on
  2026-08-17 turned out to describe 143 ClickHouse writes that all eventually
  landed and zero jobs lost.

  The inverse case matters as much and is easier to miss. Work that is
  discarded without anything being thrown has no layer above it that will ever
  report it, so the discarding layer is the last one that can. Silence there is
  data loss nobody is paged for.

  # ---------------------------------------------------------------------------
  # Who decides
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A layer that rethrows logs below error
    Given a repository whose write fails
    When it logs the failure and rethrows it
    Then the record is logged at warning level
    And the record still carries the identifiers only that layer holds

  @integration
  Scenario: The layer that gives up logs at error
    Given a retry loop that has used its last attempt
    When it stops retrying
    Then the record is logged at error level

  @integration
  Scenario: A retried attempt that later succeeds leaves no error record
    Given a handler that fails once and succeeds on the next attempt
    When the retry succeeds
    Then no record for that work is logged at error level
    And the failed attempt is still logged at warning level

  # ---------------------------------------------------------------------------
  # Discarded work
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Work discarded without a throw is logged at error
    Given a dispatcher that cannot deliver the events it was handed
    When it discards them instead of throwing
    Then the record is logged at error level
    And the record states how many events were discarded

  # ---------------------------------------------------------------------------
  # The failures this rule was written from
  # ---------------------------------------------------------------------------

  @unit @regression
  Scenario: A ClickHouse write failure beneath the queue is a warning
    Given a canonical metric point write that ClickHouse refuses
    When the repository rethrows for the queue to retry
    Then the record is logged at warning level

  @unit @regression
  Scenario: An evaluation analytics write failure beneath the queue is a warning
    Given an evaluation analytics write that ClickHouse refuses
    When the repository rethrows for the queue to retry
    Then the record is logged at warning level

  @unit @regression
  Scenario: Dropping events after the projection router is gone is an error
    Given a projection registry whose router has been closed
    When events are dispatched to it and cannot be routed
    Then the record is logged at error level
