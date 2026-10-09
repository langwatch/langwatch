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
  # Scope of what these scenarios observe: the step that turns an incoming
  # attribute into a value, which every span event's attributes pass through
  # on the ingest path. They do not replay a write to storage and read it
  # back, so they establish that the value survives normalization and not
  # that no later step drops it. That is the whole of the reported loss as
  # far as it was traced, and it is the step where the loss was found.
  #
  # Bindings:
  #   platform/app/src/server/event-sourcing/pipelines/trace-processing/utils/traceRequest.utils.ts
  #   platform/app/src/server/event-sourcing/pipelines/trace-processing/utils/__tests__/traceRequest.utils.test.ts

  @unit
  Scenario: A neutral vote is kept as the value it was sent as
    Given an event attribute whose reading is zero
    When the attribute is normalized on the way in
    Then the normalized attributes carry that reading

  @unit
  Scenario: A zero sent over the wire as text is still a zero
    Given an event attribute whose reading arrives as text
    When the attribute is normalized on the way in
    Then the normalized attributes carry that reading as a number

  # Not reachable from the tracked-event endpoint, which sends one number per
  # metric — this covers the same value arriving on an ordinary span.
  @unit
  Scenario: A list of readings keeps the zeroes in it
    Given an attribute carrying a list of readings, one of them zero
    When the attribute is normalized on the way in
    Then the normalized list carries every reading it was sent

  # The distinction the truthiness check destroyed, stated the other way
  # round: an attribute that genuinely carries nothing is still absent.
  @unit
  Scenario: An attribute that carries no value at all is still absent
    Given an attribute with no value at all
    When the attribute is normalized on the way in
    Then the normalized attributes do not carry it
