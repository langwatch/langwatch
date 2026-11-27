Feature: How the event queue answers ClickHouse refusals
  As the event-sourcing queue retrying jobs that ClickHouse refused
  I want data ClickHouse can never accept to stop retrying, and a refusal for want of a slot to wait
  So that a bad row does not spend the whole retry budget and refused jobs do not retake the slots

  # A shared async flush hands one caller's parse error to every member, so early attempts stay
  # retryable: by the eighth a job has waited far past a sub-second flush, and only the culprit
  # still fails. Type errors count only on an insert, since a read may meet a column mid-change.

  @unit
  Scenario: A job whose data ClickHouse refuses stops retrying from its eighth attempt
    Given a single job whose insert ClickHouse refuses as unparseable or of the wrong type
    When it fails on an attempt before the eighth
    Then it stays retryable
    But from the eighth attempt it is refused as non-retryable, with the refusal kept as its cause

  @unit
  Scenario: A type error on a read is never refused as bad data
    Given a job whose read ClickHouse refuses with a type error
    When the failure is classified
    Then it stays retryable, since a column may be changing type during a deploy

  @unit
  Scenario: A job refused for want of a statement slot waits a jittered 2 to 5 seconds
    Given a job that ClickHouse refuses with code 202, or that the client shed for want of a slot
    When the queue is handed the failure
    Then it names a retry delay between 2 and 5 seconds
    And jobs refused together are spread across that window
