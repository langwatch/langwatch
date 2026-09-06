Feature: A reading of zero survives ingest
  As someone recording a tracked event against a trace
  I want a reading of zero to be stored as zero
  So that a neutral answer is not read back as no answer at all

  # A tracked event's metrics travel as numeric attributes on the span, and
  # the step that turns an OTLP attribute into a value asked whether the
  # number was truthy. Zero is not, so the attribute was built, accepted with
  # a 200, and then dropped on the way to storage — while every other value on
  # the same path stored fine.
  #
  # The vote on a thumbs-up/down event is allowed anywhere between -1 and 1, so
  # 0 is a legal neutral vote and the only one that could not survive. The same
  # went for any custom metric that happened to be zero: a count of 0, a
  # latency of 0, a score of 0. Downstream — filters, the event drilldown,
  # trigger matching — the event read as carrying nothing rather than carrying
  # a neutral reading.
  #
  # Bindings:
  #   platform/app/src/server/event-sourcing/pipelines/trace-processing/utils/traceRequest.utils.ts
  #   platform/app/src/server/event-sourcing/pipelines/trace-processing/utils/__tests__/traceRequest.utils.test.ts

  @unit
  Scenario: A neutral vote is stored as the value it was sent as
    Given a tracked event whose reading is zero
    When the event is ingested
    Then the stored event carries that reading

  @unit
  Scenario: A zero sent over the wire as text is still a zero
    Given a tracked event whose reading arrives as text
    When the event is ingested
    Then the stored event carries that reading as a number

  @unit
  Scenario: A list of readings keeps the zeroes in it
    Given a tracked event carrying a list of readings, one of them zero
    When the event is ingested
    Then the stored list carries every reading it was sent

  # The distinction the truthiness check destroyed, stated the other way
  # round: an attribute that genuinely carries nothing is still absent.
  @unit
  Scenario: An attribute that carries no value at all is still absent
    Given a tracked event carrying an attribute with no value
    When the event is ingested
    Then the stored event does not carry that attribute
