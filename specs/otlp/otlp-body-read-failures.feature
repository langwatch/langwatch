Feature: OTLP body read failures

  An OTLP exporter that gives up mid-upload leaves the receiver holding a torn
  request stream. That is the sender's connection ending, not a fault in the
  receiver, and it has to be answered as one.

  In production it was not. Reading such a body raised whatever the stream
  implementation happened to throw, nothing classified it, and the request
  boundary saw an unhandled error and answered 500 — roughly 190 a day, every
  one of them counted as a server fault and paged on as one.

  Two things made the failure harder to read than it needed to be. The reader
  was released in a `finally` block, and a release that throws from `finally`
  REPLACES the error on its way out, so the log named a stream-internals
  TypeError rather than the disconnect that caused it. And an unsupported
  `Content-Encoding` — plainly the sender's mistake — took the same unclassified
  path to the same 500.

  Background:
    Given the shared OTLP body reader used by the traces, logs and metrics routes

  # ---------------------------------------------------------------------------
  # Classification
  # ---------------------------------------------------------------------------

  @unit @regression
  Scenario: A body that cannot be read is the sender's fault
    When the request stream fails part-way through being read
    Then the failure is reported as an unreadable body
    And the response status is 400
    And the failure is attributed to the sender

  @unit @regression
  Scenario: A body that was already consumed is reported the same way
    When the request stream has already been read
    Then the failure is reported as an unreadable body
    And the response status is 400

  @unit @regression
  Scenario: An unsupported content encoding is answered as a client error
    When a body arrives under a Content-Encoding we do not support
    Then the response status is 400
    And the response names the encoding that was refused

  # A body truncated by a disconnect, or one that was never the encoding it
  # claimed, both surface from zlib rather than from the read. Same fault, so
  # the same answer - it reached the boundary unclassified before.
  @unit @regression
  Scenario: A body that does not decompress is the sender's fault
    When a body arrives that does not decompress under its declared encoding
    Then the failure is reported as an unreadable body
    And the response status is 400

  # ---------------------------------------------------------------------------
  # The original error survives
  #
  # The whole diagnosis is which condition ended the read, so nothing on the way
  # out is allowed to overwrite it.
  # ---------------------------------------------------------------------------

  @unit @regression
  Scenario: Releasing the reader never replaces the failure being reported
    Given releasing the reader throws
    When the request stream fails part-way through being read
    Then the reported failure is still the unreadable body
    And the error raised by releasing the reader is not reported

  @unit @regression
  Scenario: Releasing the reader never fails a successful read
    Given releasing the reader throws
    When the body is read to completion
    Then the body is returned intact

  @unit @regression
  Scenario: The underlying cause is kept for diagnosis
    When the request stream fails part-way through being read
    Then the reported failure carries the original error as its cause

  # ---------------------------------------------------------------------------
  # The size bound still wins
  #
  # An over-sized body is refused with its own status, and must not be
  # reclassified as merely unreadable by the handling added around it.
  # ---------------------------------------------------------------------------

  @unit @regression
  Scenario: An over-sized body is still refused as too large
    When a body passes the byte limit while being read
    Then the failure is reported as a body that is too large
    And the response status is 413

  @unit @regression
  Scenario: A cancel that throws does not hide the size refusal
    Given cancelling the reader throws
    When a body passes the byte limit while being read
    Then the failure is still reported as a body that is too large
