Feature: ClickHouse analytics stays available under concurrent query load
  When many dashboards, monitor graphs, and live "new traces" pollers hit ClickHouse
  at the same time, the server can briefly reject queries with
  "Too many simultaneous queries. Maximum: 100." This is a transient overload
  signal, not a failure of the request itself: a slot frees within moments.

  Reads are idempotent, so the platform should ride through a transient overload
  spike instead of surfacing it to the operator as a 500. Live pollers should ease
  off when ClickHouse is overloaded so the client does not amplify the storm.

  Background:
    Given a user is viewing analytics backed by ClickHouse

  @unit @regression
  Scenario: A read rejected for transient overload is retried and succeeds
    Given ClickHouse rejects the first read with "Too many simultaneous queries"
    And the next read would succeed once a query slot frees
    When the analytics query runs
    Then the read is retried after a short backoff
    And the user receives the query result instead of an error

  @unit @regression
  Scenario: A read that keeps failing transiently eventually surfaces the error
    Given ClickHouse rejects every read with a transient overload error
    When the analytics query runs
    Then the read is retried a bounded number of times with backoff
    And the error is surfaced only after retries are exhausted

  @unit @regression
  Scenario: A read failing with a non-transient error fails fast
    Given ClickHouse rejects a read with a query syntax error
    When the analytics query runs
    Then the read is not retried
    And the error is surfaced immediately

  # Writes are not idempotent: there is no insert dedup token, so a batch that
  # failed after it was sent (a reset, a hang up, a cancelled query) may already
  # have landed, and retrying it in place writes it twice. The job that owns the
  # write retries it instead. Only a refused connection provably sent nothing.

  @unit @regression
  Scenario: An insert that failed after it was sent is not retried in place
    Given ClickHouse drops the connection while an insert is in flight
    When the insert runs
    Then the insert is attempted exactly once
    And the failure is surfaced to the caller unchanged

  @unit @regression
  Scenario: An insert whose connection was refused before sending is retried
    Given ClickHouse refuses the connection for the first insert attempt
    When the insert runs
    Then the insert is retried and the batch is written once

  @unit @regression @unimplemented
  Scenario: The traces view updates on its server event and never on a timer
    Given the traces view is showing the newest traces
    When ClickHouse is overloaded and a read fails
    Then no timer retries it
    And the view updates again on the next server event that names new traces
