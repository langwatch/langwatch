Feature: Request log level and where the cause is attached

  Every request that fails leaves one record, and that record answers two
  questions independently: how bad was it, and what went wrong. The level
  answers the first. The field the cause is attached to must not quietly answer
  it a second time, differently.

  A handled failure attributed to the customer - over quota, malformed payload,
  not found - is expected traffic. It is watched by rate, not woken up for. So
  it is logged below error, and the record must not then carry a key called
  `error`, which is the loudest possible claim that it failed.

  The catch is that moving the cause is not free. pino applies serializers by
  exact property name and warns about nothing when a key has none: an `Error`
  has no enumerable own properties, so an unserialised one is written as `{}`
  and the message and stack - the only reasons a cause is logged at all - are
  gone. The record still looks well-formed. This is a real regression that
  shipped in this branch and was caught in review, which is why the last two
  scenarios read the emitted line rather than the object handed to the logger.

  Background:
    Given a request that failed

  # ---------------------------------------------------------------------------
  # The level
  # ---------------------------------------------------------------------------

  @unit @regression
  Scenario: A handled customer failure is logged below error
    When the failure is attributed to the customer
    Then the record is logged at warning level
    And the handled code and fault are carried on the record

  @unit @regression
  Scenario: A platform fault is logged at error
    When the failure is attributed to the platform
    Then the record is logged at error level

  # ---------------------------------------------------------------------------
  # A failure with nothing attached
  #
  # A route can answer 5xx without an error ever reaching the middleware —
  # returning the response rather than throwing. The record is then logged at
  # error level, because the status says so, while the message still reads
  # `request handled` and no cause is attached to it. It is indistinguishable
  # from a success except by reading the status field.
  #
  # That is not hypothetical. In one hour on 2026-08-13 production logged
  # 12,367 such records, every one of them a 500, and between them they said
  # nothing at all about what had failed. A record that cannot be told apart
  # from a healthy one is worse than no record: it is found only by whoever
  # already suspected it was there.
  # ---------------------------------------------------------------------------

  @unit @regression
  Scenario: A server error with no cause attached says so
    When the response is a server error and no cause reached the logger
    Then the record does not claim the request was handled
    And the record states that no cause was attached
    And the record is logged at error level

  @unit @regression
  Scenario: A successful request is still reported as handled
    When the response succeeds
    Then the record reports the request as handled

  # ---------------------------------------------------------------------------
  # Where the cause goes
  # ---------------------------------------------------------------------------

  @unit @regression
  Scenario: A record below error level does not carry a field named error
    When the record is logged below error level
    Then the cause is attached under the request-cause field
    And no field named "error" is emitted

  @unit @regression
  Scenario: A record at error level keeps its cause on the error field
    When the record is logged at error level
    Then the cause is attached under "error"
    And the request-cause field is not emitted

  @unit @regression
  Scenario: The error type stays groupable after the cause is re-keyed
    When the record is logged below error level
    Then the type of the failure is stated on the record in its own right

  # ---------------------------------------------------------------------------
  # What the emitted line actually contains
  #
  # Asserting on the object handed to the logger passes whether or not a
  # serializer is registered, so these read the written line.
  # ---------------------------------------------------------------------------

  @unit @regression
  Scenario: A re-keyed cause is still serialised
    When the record is logged below error level
    Then the emitted line carries the failure's message
    And the emitted line carries the failure's stack

  @unit @regression
  Scenario: A cause on the error field is serialised as it always was
    When the record is logged at error level
    Then the emitted line carries the failure's message
    And the emitted line carries the failure's stack
